export type {
  AIMessage,
  AIMessageRole,
  AICompletionRequest,
  AICompletionResult,
  AICompletionUsage,
  AIProvider,
} from './types';

export { createAIProvider, createAIProviderFromEnv } from './registry';
export type { ProviderConfig, SupportedProvider } from './registry';

export type { EmbeddingProvider } from './embeddings/types';
export { MockEmbeddingProvider } from './embeddings/MockEmbeddingProvider';
export { OpenAIEmbeddingProvider } from './embeddings/OpenAIEmbeddingProvider';
export { createEmbeddingProvider, createEmbeddingProviderFromEnv } from './embeddings/registry';
export type { EmbeddingProviderConfig, SupportedEmbeddingProvider } from './embeddings/registry';
