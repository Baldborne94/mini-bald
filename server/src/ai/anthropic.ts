import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiFeedbackSchema, aiRecipeSchema, type AiFeedback, type AiRecipe, type AiTutorials } from '@minibald/shared';
import type { z } from 'zod';
import type { Config } from '../config.ts';
import { feedbackSystem, feedbackUser, recipeSystem, recipeUser, tutorialsSystem, tutorialsUser } from './prompts.ts';
import { AiError, type AiImage, type AiProvider, type AiResult, type FeedbackBrief, type RecipeBrief, type TutorialsBrief } from './provider.ts';


// Non-streaming requests: comfortably under the SDK's HTTP timeout, and far more than these answers need.
const MAX_TOKENS = 16000;
// Models that accept the server-side refusal fallback. If the configured model declines a
// request for policy reasons, the API re-runs it on a fallback model within the same call.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
// A web search turn can pause after a batch of searches; we resume it this many times at most.
const MAX_CONTINUATIONS = 3;

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;
  private effort: Effort | null;
  private webSearchTool: string;

  constructor(config: Config['ai']) {
    this.model = config.model;
    this.effort = (config.effort as Effort | null) ?? null;
    this.webSearchTool = config.webSearchTool;
    // The key is passed explicitly so the app never picks up credentials from elsewhere on the machine.
    this.client = new Anthropic({ apiKey: config.apiKey, ...(config.baseUrl && { baseURL: config.baseUrl }), maxRetries: 2 });
  }

  /** Request fields shared by every call. Thinking is left to the model's default (adaptive). */
  private common() {
    return {
      model: this.model,
      max_tokens: MAX_TOKENS,
      ...(FALLBACK_MODELS.has(this.model) && { betas: [FALLBACK_BETA], fallbacks: 'default' as const }),
    };
  }

  private async structured<S extends z.ZodType>(schema: S, system: string, text: string, image: AiImage | null): Promise<AiResult<z.infer<S>>> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    // Images go before the text that refers to them.
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
    content.push({ type: 'text', text });
    try {
      const message = await this.client.beta.messages.parse({
        ...this.common(),
        system,
        messages: [{ role: 'user', content }],
        output_config: { format: betaZodOutputFormat(schema), ...(this.effort && { effort: this.effort }) },
      });
      this.assertComplete(message);
      if (message.parsed_output === null) throw new AiError(502, 'The model did not return a usable structured answer. Try again.');
      return { output: message.parsed_output as z.infer<S>, model: message.model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
    } catch (err) {
      throw this.translate(err);
    }
  }

  suggestRecipe(brief: RecipeBrief): Promise<AiResult<AiRecipe>> {
    return this.structured(aiRecipeSchema, recipeSystem(brief.language), recipeUser(brief), brief.image);
  }

  critique(brief: FeedbackBrief): Promise<AiResult<AiFeedback>> {
    return this.structured(aiFeedbackSchema, feedbackSystem(brief.language), feedbackUser(brief), brief.image);
  }

  /**
   * Web search runs on Anthropic's side. Links are taken only from the search results the API
   * returns (citations first), never from the model's prose, so a URL cannot be invented.
   * Structured output is not used here: it cannot be combined with citations.
   */
  async findTutorials(brief: TutorialsBrief): Promise<AiResult<AiTutorials>> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: tutorialsUser(brief) }];
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      let message: Anthropic.Beta.BetaMessage;
      for (let attempt = 0; ; attempt++) {
        message = await this.client.beta.messages.create({
          ...this.common(),
          system: tutorialsSystem(brief.language),
          messages,
          tools: [{ type: this.webSearchTool as 'web_search_20260209', name: 'web_search', max_uses: 5 }],
          ...(this.effort && { output_config: { effort: this.effort } }),
        });
        inputTokens += message.usage.input_tokens;
        outputTokens += message.usage.output_tokens;
        if (message.stop_reason !== 'pause_turn' || attempt >= MAX_CONTINUATIONS) break;
        // Resume a paused server-tool turn by sending the assistant content back unchanged.
        messages.splice(1, messages.length - 1, { role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      }
      this.assertComplete(message);

      const cited = new Map<string, AiTutorials['links'][number]>();
      const found = new Map<string, AiTutorials['links'][number]>();
      let summary = '';
      let searchError: string | null = null;
      for (const block of message.content) {
        if (block.type === 'text') {
          summary += block.text;
          for (const c of block.citations ?? []) {
            if (c.type === 'web_search_result_location' && !cited.has(c.url)) cited.set(c.url, { title: c.title ?? c.url, url: c.url, snippet: c.cited_text || null });
          }
        } else if (block.type === 'web_search_tool_result') {
          // A list on success, a single error object on failure.
          if (Array.isArray(block.content)) {
            for (const r of block.content) if (!found.has(r.url)) found.set(r.url, { title: r.title, url: r.url, snippet: null });
          } else searchError = block.content.error_code;
        }
      }
      const links = [...(cited.size > 0 ? cited : found).values()].slice(0, 12);
      if (links.length === 0 && searchError) throw new AiError(502, `Web search failed (${searchError}). Check that web search is enabled for your Anthropic organization.`);
      return { output: { summary: summary.trim(), links }, model: message.model, inputTokens, outputTokens };
    } catch (err) {
      throw this.translate(err);
    }
  }

  private assertComplete(message: Anthropic.Beta.BetaMessage) {
    if (message.stop_reason === 'refusal') {
      throw new AiError(422, `The model declined this request${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`);
    }
    if (message.stop_reason === 'max_tokens') throw new AiError(502, 'The answer was cut off before it was complete. Try again.');
  }

  /** Turns SDK errors into messages a person can act on. Most specific classes first. */
  private translate(err: unknown): Error {
    if (err instanceof AiError) return err;
    if (err instanceof Anthropic.AuthenticationError) return new AiError(502, 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.PermissionDeniedError) return new AiError(502, `This API key may not use ${this.model}: ${err.message}`);
    if (err instanceof Anthropic.NotFoundError) return new AiError(502, `Model "${this.model}" was not found. Check AI_MODEL.`);
    if (err instanceof Anthropic.RateLimitError) return new AiError(429, 'Anthropic rate limit reached. Wait a moment and try again.');
    if (err instanceof Anthropic.BadRequestError) return new AiError(502, `Anthropic rejected the request: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) return new AiError(504, 'Could not reach the Anthropic API. Check the internet connection of the machine running MiniBald.');
    if (err instanceof Anthropic.APIError) return new AiError(502, `Anthropic API error ${err.status ?? ''}: ${err.message}`);
    return err as Error;
  }
}
