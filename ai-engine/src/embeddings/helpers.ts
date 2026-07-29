import type { EmbeddingProvider } from './types';

/**
 * Phase 3.6's requested `embedText()`/`embedBatch()`/`dimensions()`/`modelName()` shape, implemented as thin
 * free functions over the existing `EmbeddingProvider` interface (`name`/`dimensions` properties, batch
 * `embed()`) rather than as new interface methods — every implementer (`MockEmbeddingProvider`,
 * `OpenAIEmbeddingProvider`) and every consumer (`MemoryService`, `DocumentService`,
 * `ConversationIntelligenceService`, `ProactiveIntelligenceService`, `EmbeddingService`) already depends on
 * that shape, so changing it would ripple across the codebase for no functional gain — the same "extend, don't
 * rename" call Phase 3.4 made for `MemoryRecord`/`RankedMemoryResult`
 * (docs/decisions/0021-semantic-search-and-context-retrieval.md).
 */

/** Embeds a single string — a convenience wrapper around the provider's batch `embed()`. */
export async function embedText(provider: EmbeddingProvider, text: string): Promise<number[]> {
  const [vector] = await provider.embed([text]);
  return vector;
}

/** Embeds a batch of strings — an explicit alias for `provider.embed()`, named for callers that expect `embedBatch`. */
export async function embedBatch(provider: EmbeddingProvider, texts: string[]): Promise<number[][]> {
  return provider.embed(texts);
}

/** The provider's model/name identifier, as a function accessor over the `name` property. */
export function modelName(provider: EmbeddingProvider): string {
  return provider.name;
}

/** The provider's vector dimensionality, as a function accessor over the `dimensions` property. */
export function dimensions(provider: EmbeddingProvider): number {
  return provider.dimensions;
}
