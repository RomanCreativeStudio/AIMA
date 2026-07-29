import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';
import { toVectorLiteral } from '../db/vector';
import { WorkspaceNotFoundError } from '../types/errors';
import { ChunkingService } from './chunkingService';
import type { EmbeddingSourceType, IndexContentInput, IndexResult } from './types';

/**
 * Generates, stores, and updates embeddings in the generic `embeddings`
 * table (database/migrations/0019_embeddings.sql) for content types that
 * have no first-class embedding column of their own — conversations and
 * tasks today (`INDEXABLE_SOURCE_TYPES`). Never calls an AI provider
 * directly; only the injected `EmbeddingProvider` abstraction
 * (docs/decisions/0021-semantic-search-and-context-retrieval.md).
 *
 * Change detection: each stored chunk keeps a sha256 `content_hash` of its
 * text. Re-indexing recomputes chunks and hashes but only calls
 * `embeddingProvider.embed()` — and only overwrites a row — for chunks
 * whose hash actually changed, so unchanged content is never re-embedded.
 * Chunks that no longer exist (the source shrank) are deleted.
 */
export class EmbeddingService {
  private modelId: string | null = null;

  constructor(
    private readonly db: Queryable,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly chunkingService: ChunkingService = new ChunkingService(),
  ) {}

  async indexContent(input: IndexContentInput): Promise<IndexResult> {
    await this.assertWorkspaceExists(input.workspaceId);
    const modelId = await this.ensureModel();

    const chunks = this.chunkingService.chunk(input.content);

    const existing = await this.db.query<{ chunk_index: number; content_hash: string }>(
      `SELECT chunk_index, content_hash FROM embeddings
       WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3`,
      [input.workspaceId, input.sourceType, input.sourceId],
    );
    const existingHashByIndex = new Map(existing.rows.map((row) => [row.chunk_index, row.content_hash]));

    let chunksIndexed = 0;
    let chunksSkipped = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const content = chunks[chunkIndex];
      const contentHash = hashContent(content);

      if (existingHashByIndex.get(chunkIndex) === contentHash) {
        chunksSkipped += 1;
        continue;
      }

      const [embedding] = await this.embeddingProvider.embed([content]);

      await this.db.query(
        `INSERT INTO embeddings
           (workspace_id, source_type, source_id, chunk_index, content, content_hash, embedding_model_id, embedding, embedding_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, 1)
         ON CONFLICT (workspace_id, source_type, source_id, chunk_index)
         DO UPDATE SET
           content = EXCLUDED.content,
           content_hash = EXCLUDED.content_hash,
           embedding_model_id = EXCLUDED.embedding_model_id,
           embedding = EXCLUDED.embedding,
           embedding_version = embeddings.embedding_version + 1,
           indexed_at = now()`,
        [
          input.workspaceId,
          input.sourceType,
          input.sourceId,
          chunkIndex,
          content,
          contentHash,
          modelId,
          toVectorLiteral(embedding),
        ],
      );
      chunksIndexed += 1;
    }

    const staleIndexes = existing.rows.map((row) => row.chunk_index).filter((index) => index >= chunks.length);
    let chunksDeleted = 0;
    if (staleIndexes.length > 0) {
      const result = await this.db.query(
        `DELETE FROM embeddings
         WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3 AND chunk_index = ANY($4::int[])`,
        [input.workspaceId, input.sourceType, input.sourceId, staleIndexes],
      );
      chunksDeleted = result.rowCount ?? 0;
    }

    return { sourceType: input.sourceType, sourceId: input.sourceId, chunksIndexed, chunksSkipped, chunksDeleted };
  }

  /** Removes every indexed chunk for one source — used when a conversation or task is deleted. */
  async deleteSource(workspaceId: string, sourceType: EmbeddingSourceType, sourceId: string): Promise<void> {
    await this.db.query('DELETE FROM embeddings WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3', [
      workspaceId,
      sourceType,
      sourceId,
    ]);
  }

  /**
   * Upserts (and caches) the `embedding_models` row for the injected
   * provider. `EmbeddingProvider` exposes only `name`/`dimensions` — no
   * separate provider-vs-model distinction — so both columns store `name`.
   */
  private async ensureModel(): Promise<string> {
    if (this.modelId) {
      return this.modelId;
    }

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO embedding_models (provider_name, model_name, dimensions)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider_name, model_name) DO UPDATE SET dimensions = EXCLUDED.dimensions
       RETURNING id`,
      [this.embeddingProvider.name, this.embeddingProvider.name, this.embeddingProvider.dimensions],
    );
    this.modelId = result.rows[0].id;
    return this.modelId;
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
