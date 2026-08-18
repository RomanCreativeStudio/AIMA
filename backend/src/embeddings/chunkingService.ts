import { chunkDocument } from '../knowledge/chunking';

const DEFAULT_MAX_CHUNK_CHARS = 1000;

/**
 * Splits long content into embeddable chunks for the generic `embeddings`
 * table. Reuses `knowledge/chunking.ts#chunkDocument` (Phase 1.5) rather than
 * reimplementing paragraph-aware, deterministic chunking — the same content
 * and `maxChunkChars` always produce the same chunks, which is what makes
 * `EmbeddingService`'s content-hash change detection meaningful.
 */
export class ChunkingService {
  chunk(content: string, maxChunkChars: number = DEFAULT_MAX_CHUNK_CHARS): string[] {
    return chunkDocument(content, maxChunkChars).map((draft) => draft.content);
  }
}
