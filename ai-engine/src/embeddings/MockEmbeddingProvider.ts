import type { EmbeddingProvider } from './types';

const DEFAULT_DIMENSIONS = 1536;

/**
 * Deterministic, no-network embedding provider — the default for local
 * development and tests. Uses the classic "hashing trick": each word in the
 * text is hashed into a fixed-size bucket, so texts that share words end up
 * with genuinely closer vectors (unlike a naive whole-string hash). This is
 * not a semantic embedding model — it exists so the retrieval pipeline
 * (storage, ranking, filtering) can be built and tested without a paid
 * provider or network access.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly dimensions: number;

  constructor(dimensions: number = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    for (const word of words) {
      const bucket = fnv1aHash(word) % this.dimensions;
      vector[bucket] += 1;
    }

    return normalize(vector);
  }
}

function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash);
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}
