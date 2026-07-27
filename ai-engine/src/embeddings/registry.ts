import type { EmbeddingProvider } from './types';
import { MockEmbeddingProvider } from './MockEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider';

export type SupportedEmbeddingProvider = 'mock' | 'openai';

export interface EmbeddingProviderConfig {
  provider: SupportedEmbeddingProvider;
  apiKey?: string;
  model?: string;
}

/**
 * The only place in the codebase allowed to know which concrete
 * EmbeddingProvider classes exist — mirrors ../registry.ts for AIProvider.
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('EMBEDDING_PROVIDER_API_KEY is required when EMBEDDING_PROVIDER=openai');
      }
      return new OpenAIEmbeddingProvider(config.apiKey, config.model);
    case 'mock':
      return new MockEmbeddingProvider();
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown embedding provider: ${exhaustiveCheck}`);
    }
  }
}

/** Reads EMBEDDING_PROVIDER / EMBEDDING_PROVIDER_API_KEY / EMBEDDING_PROVIDER_MODEL from process.env. */
export function createEmbeddingProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider {
  const provider = (env.EMBEDDING_PROVIDER ?? 'mock') as SupportedEmbeddingProvider;

  return createEmbeddingProvider({
    provider,
    apiKey: env.EMBEDDING_PROVIDER_API_KEY,
    model: env.EMBEDDING_PROVIDER_MODEL,
  });
}
