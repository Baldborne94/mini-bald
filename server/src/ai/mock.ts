import type { AiFeedback, AiRecipe, AiTutorials } from '@minibald/shared';
import type { AiProvider, AiResult, FeedbackBrief, RecipeBrief, TutorialsBrief } from './provider.ts';

const result = <T>(output: T): AiResult<T> => ({ output, model: 'mock-1', inputTokens: 100, outputTokens: 200 });

/**
 * Canned answers shaped like the real ones (AI_PROVIDER=mock). Used by the tests and for
 * working on the interface without spending tokens; also the smallest example of a provider.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';

  async suggestRecipe(brief: RecipeBrief): Promise<AiResult<AiRecipe>> {
    const owned = brief.inventory.filter((p) => p.stock === 'owned' || p.stock === 'low');
    return result({
      name: `${brief.scheme ?? 'Classic'} scheme for ${brief.miniature.name}`,
      summary: `A mock plan${brief.image ? ' based on your photo' : ''}. Set AI_PROVIDER=anthropic for real advice.`,
      steps: [
        { phase: 'prime', area: 'Whole model', paint: 'Mock Black Primer', technique: 'Spray', notes: 'Two light passes.', alternative: owned[0]?.label ?? null },
        { phase: 'base', area: 'Main colour', paint: owned[0]?.label ?? 'Mock Blue', technique: 'Basecoat', notes: 'Two thin coats.', alternative: null },
        { phase: 'shade', area: 'Recesses', paint: owned[1]?.label ?? 'Mock Wash', technique: 'Recess wash', notes: 'Keep it out of flat panels.', alternative: null },
        { phase: 'basing', area: 'Base', paint: null, technique: 'Texture', notes: 'Glue sand, then drybrush.', alternative: null },
      ],
      tips: ['Thin your paints.', 'Let each layer dry.'],
    });
  }

  async critique(brief: FeedbackBrief): Promise<AiResult<AiFeedback>> {
    return result({
      overall: `Mock feedback for ${brief.miniature.name}.`,
      strengths: ['Clean basecoats.'],
      improvements: [{ area: brief.focus ?? 'Edges', issue: 'Highlights are a little thick.', how: 'Use the side of the brush with thinner paint.' }],
      nextStep: 'Tidy the edge highlights on the shoulder pads.',
    });
  }

  async findTutorials(brief: TutorialsBrief): Promise<AiResult<AiTutorials>> {
    return result({
      summary: `Mock search for "${brief.miniature.name}${brief.query ? ` ${brief.query}` : ''}".`,
      links: [{ title: 'Example painting guide', url: 'https://example.com/guide', snippet: 'A placeholder result.' }],
    });
  }
}
