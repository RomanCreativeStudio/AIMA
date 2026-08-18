import type { EmbeddingProvider } from './types';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Calls OpenAI's embeddings endpoint directly via fetch rather than pulling
 * in the full `openai` SDK — this is the only network call this provider
 * needs, so a dependency for it would be unnecessary weight
 * (docs/DEVELOPMENT_SETUP.md §9, Rule 1).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions = DIMENSIONS;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI embeddings request failed (${response.status}): ${errorBody}`);
    }

    const body = (await response.json()) as OpenAIEmbeddingResponse;
    return body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
