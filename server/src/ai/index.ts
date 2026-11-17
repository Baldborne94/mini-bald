import type { Config } from '../config.ts';
import { AnthropicProvider } from './anthropic.ts';
import { MockProvider } from './mock.ts';
import type { AiProvider } from './provider.ts';

/** Returns null when the assistant is not configured: the rest of the app works without it. */
export function createAiProvider(config: Config['ai']): AiProvider | null {
  if (config.provider === 'mock') return new MockProvider();
  if (config.provider === 'anthropic') return config.apiKey ? new AnthropicProvider(config) : null;
  throw new Error(`Unknown AI_PROVIDER "${config.provider}" (expected "anthropic" or "mock")`);
}
