import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { AnthropicProvider } from '../src/ai/anthropic.ts';
import { loadConfig } from '../src/config.ts';
import { AiError, type MiniatureBrief } from '../src/ai/provider.ts';

// The real API is not called in tests. A local stand-in records what the provider sends and
// answers with canned Messages API responses, so the request shape is pinned down.

interface Captured {
  headers: http.IncomingHttpHeaders;
  body: Record<string, any>;
}
let server: http.Server;
let baseUrl: string;
const requests: Captured[] = [];
let replies: Record<string, unknown>[] = [];

const message = (extra: Record<string, unknown>) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 45 },
  ...extra,
});

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      const reply = replies.shift() ?? { status: 500, json: { type: 'error', error: { type: 'api_error', message: 'no canned reply' } } };
      const { status = 200, json } = reply as { status?: number; json: unknown };
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => void server.close(() => resolve())));

const provider = (env: Record<string, string> = {}) =>
  new AnthropicProvider(loadConfig({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: baseUrl, ...env }).ai);

const miniature: MiniatureBrief = { name: 'Intercessor', group: 'Ultramarines', parentGroup: 'Warhammer 40K', description: null, notes: null, status: 'primed', quantity: 1, tags: ['Infantry'] };
const recipe = {
  name: 'Blue armour',
  summary: 'Deep blue.',
  steps: [{ phase: 'base', area: 'Armour', paint: 'Citadel Macragge Blue', technique: 'Basecoat', notes: 'Two thin coats.', alternative: null }],
  tips: ['Thin your paints.'],
};

test('recipe request: image first, JSON schema output, refusal fallback, no thinking or sampling overrides', async () => {
  requests.length = 0;
  replies = [{ json: message({ content: [{ type: 'text', text: JSON.stringify(recipe) }] }) }];
  const result = await provider().suggestRecipe({
    miniature,
    scheme: 'Classic blue',
    inventory: [
      { label: 'Citadel Macragge Blue', range: 'Base', type: 'Base', stock: 'owned' },
      { label: 'Citadel Nuln Oil', range: 'Shade', type: 'Shade', stock: 'out' },
    ],
    image: { mediaType: 'image/jpeg', base64: 'AAAA' },
    language: 'Italian',
  });
  assert.deepEqual(result.output, recipe);
  assert.deepEqual([result.model, result.inputTokens, result.outputTokens], ['claude-opus-5-5', 120, 45]);

  const { headers, body } = requests[0]!;
  // SDK 1.x sends the key as a bearer token.
  assert.equal(headers.authorization, 'Bearer test-key');
  assert.match(headers['anthropic-beta'] as string, /server-side-fallback-2026-07-01/);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.max_tokens, 16000);
  for (const absent of ['thinking', 'temperature', 'top_p', 'tool_choice']) assert.equal(absent in body, false, absent);
  assert.match(body.system, /Italian/);

  const [image, text] = body.messages[0].content;
  assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.match(text.text, /Citadel Macragge Blue \(Base\)/);
  // An empty pot is not offered to the model as something to paint with.
  assert.equal(text.text.includes('Nuln Oil'), false);

  const format = body.output_config.format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.schema.additionalProperties, false);
  assert.deepEqual(format.schema.required.sort(), ['name', 'steps', 'summary', 'tips']);
  assert.ok(format.schema.properties.steps.items.properties.phase.enum.includes('highlight'));
  assert.equal('effort' in body.output_config, false);
});

test('model and effort come from configuration; other models get no fallback parameter', async () => {
  requests.length = 0;
  replies = [{ json: message({ model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify({ overall: 'Good.', strengths: [], improvements: [], nextStep: 'Highlights.' }) }] }) }];
  const result = await provider({ AI_MODEL: 'claude-haiku-5-5', AI_EFFORT: 'low' }).critique({
    miniature,
    focus: null,
    recipe: null,
    image: { mediaType: 'image/jpeg', base64: 'AAAA' },
    language: 'English',
  });
  assert.equal(result.output.nextStep, 'Highlights.');
  const { headers, body } = requests[0]!;
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.output_config.effort, 'low');
  assert.equal('fallbacks' in body, false);
  assert.equal(String(headers['anthropic-beta']).includes('server-side-fallback'), false);
});

test('tutorials: resumes a paused search turn and takes links from citations only', async () => {
  requests.length = 0;
  const search = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'intercessor painting guide' } };
  const results = {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_1',
    content: [
      { type: 'web_search_result', url: 'https://example.org/guide', title: 'Intercessor guide', encrypted_content: 'x', page_age: null },
      { type: 'web_search_result', url: 'https://example.org/shop', title: 'Buy Intercessors', encrypted_content: 'y', page_age: null },
    ],
  };
  replies = [
    { json: message({ stop_reason: 'pause_turn', content: [search] }) },
    {
      json: message({
        content: [
          search,
          results,
          { type: 'text', text: 'A solid step-by-step guide. ', citations: [{ type: 'web_search_result_location', url: 'https://example.org/guide', title: 'Intercessor guide', cited_text: 'Start with a blue basecoat', encrypted_index: 'z' }] },
          { type: 'text', text: 'It also mentions https://made-up.example/never-searched.', citations: null },
        ],
      }),
    },
  ];
  const result = await provider().findTutorials({ miniature, query: 'edge highlights', language: 'English' });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]!.body.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]);
  assert.equal('format' in (requests[0]!.body.output_config ?? {}), false);
  // The paused assistant turn is sent back as it was, with nothing added after it.
  assert.deepEqual(requests[1]!.body.messages.map((m: { role: string }) => m.role), ['user', 'assistant']);
  assert.deepEqual(requests[1]!.body.messages[1].content, [search]);

  assert.deepEqual(result.output.links, [{ title: 'Intercessor guide', url: 'https://example.org/guide', snippet: 'Start with a blue basecoat' }]);
  assert.match(result.output.summary, /^A solid step-by-step guide\./);
  assert.equal(result.inputTokens, 240);
});

test('refusals, search errors and API errors become clear messages', async () => {
  replies = [{ json: message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'Not something I can help with.' }, content: [] }) }];
  await assert.rejects(provider().suggestRecipe({ miniature, scheme: null, inventory: [], image: null, language: 'English' }), (err: unknown) => {
    assert.ok(err instanceof AiError);
    assert.equal(err.status, 422);
    assert.match(err.message, /declined.*Not something I can help with/);
    return true;
  });

  replies = [{ json: message({ content: [{ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } }] }) }];
  await assert.rejects(provider().findTutorials({ miniature, query: null, language: 'English' }), /Web search failed \(unavailable\)/);

  replies = [{ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }];
  await assert.rejects(provider().findTutorials({ miniature, query: null, language: 'English' }), /rejected the API key/);

  replies = [{ status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'model: nope' } } }];
  await assert.rejects(provider({ AI_MODEL: 'nope' }).findTutorials({ miniature, query: null, language: 'English' }), /Model "nope" was not found/);
});
