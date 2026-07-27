import type { AIProvider } from './types';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { MockProvider } from './providers/MockProvider';

export type SupportedProvider = 'claude' | 'mock';

export interface ProviderConfig {
  provider: SupportedProvider;
  apiKey?: string;
  model?: string;
}

/**
 * The only place in the codebase allowed to know which concrete AIProvider
 * classes exist. Adding a new provider means adding one case here — nothing
 * else in backend/ or ai-engine/ should ever import a provider class directly.
 */
export function createAIProvider(config: ProviderConfig): AIProvider {
  switch (config.provider) {
    case 'claude':
      if (!config.apiKey) {
        throw new Error('AI_PROVIDER_API_KEY is required when AI_PROVIDER=claude');
      }
      return new ClaudeProvider(config.apiKey, config.model);
    case 'mock':
      return new MockProvider();
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown AI provider: ${exhaustiveCheck}`);
    }
  }
}

/** Reads AI_PROVIDER / AI_PROVIDER_API_KEY / AI_PROVIDER_MODEL from process.env. */
export function createAIProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const provider = (env.AI_PROVIDER ?? 'mock') as SupportedProvider;

  return createAIProvider({
    provider,
    apiKey: env.AI_PROVIDER_API_KEY,
    model: env.AI_PROVIDER_MODEL,
  });
}
