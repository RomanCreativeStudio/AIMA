/**
 * The Memory Intelligence Layer's relevance scoring (Phase 3.4,
 * docs/decisions/0019-advanced-memory-system.md) — a pure, deterministic
 * function over already-retrieved candidates, mirroring the "pure function
 * over what's already known" precedent `backend/src/insights/taskAnalysis.ts`
 * and `WorkflowIntentMatcher` established: no AI call, no side effect,
 * fully unit-testable in isolation from the database.
 *
 * `MemoryService.search` narrows candidates by raw cosine similarity first
 * (cheap, index-backed), then this function re-ranks that candidate set by
 * a blended score — similarity still dominates, but a highly important or
 * highly confident memory can outrank a slightly-more-similar one, which is
 * the actual point of "context-aware retrieval": relevance is not purely
 * textual closeness.
 */
export interface MemoryRankingInput {
  /** Cosine similarity from pgvector, typically in [0, 1] for text embeddings. */
  similarity: number;
  /** How significant this memory is to the workspace, in [0, 1]. */
  importanceScore: number;
  /** How much the memory's source should be trusted, in [0, 1]. */
  confidenceScore: number;
}

export const SIMILARITY_WEIGHT = 0.6;
export const IMPORTANCE_WEIGHT = 0.25;
export const CONFIDENCE_WEIGHT = 0.15;

export function computeRelevanceScore(input: MemoryRankingInput): number {
  return (
    input.similarity * SIMILARITY_WEIGHT +
    input.importanceScore * IMPORTANCE_WEIGHT +
    input.confidenceScore * CONFIDENCE_WEIGHT
  );
}

/** Sorts by blended relevance score, highest first. Stable for ties (`Array.prototype.sort` since Node 12). */
export function rankMemories<T extends MemoryRankingInput>(candidates: T[]): Array<T & { relevanceScore: number }> {
  return candidates
    .map((candidate) => ({ ...candidate, relevanceScore: computeRelevanceScore(candidate) }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
