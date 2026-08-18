/**
 * Every embedding provider AIMA can use implements this interface. Nothing
 * outside ai-engine/src/embeddings may depend on a specific provider's SDK
 * or API shape — callers only ever see EmbeddingProvider, mirroring the
 * AIProvider pattern in ../types.ts (docs/TECHNICAL_ARCHITECTURE.md §4).
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
