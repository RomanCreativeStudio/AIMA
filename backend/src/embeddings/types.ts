import type { RankedMemoryResult } from '../memory/types';

/**
 * Content types the generic `embeddings` table (database/migrations/
 * 0019_embeddings.sql) can index. `memory` is listed for completeness but is
 * never written through this module — `memory_records.embedding` (Phases
 * 1.2/3.4) already has its own first-class column and retrieval path via
 * `MemoryService`. `note`/`document` are forward-compatible placeholders:
 * no Notes feature and no generic document type exist yet (`documents`/
 * `document_chunks`, Phase 1.5, already covers imported files).
 */
export const EMBEDDING_SOURCE_TYPES = ['memory', 'conversation', 'task', 'note', 'document'] as const;
export type EmbeddingSourceType = (typeof EMBEDDING_SOURCE_TYPES)[number];

/** The source types this module actually indexes today — see EMBEDDING_SOURCE_TYPES's note. */
export const INDEXABLE_SOURCE_TYPES = ['conversation', 'task'] as const satisfies readonly EmbeddingSourceType[];

export interface EmbeddingRecord {
  id: string;
  workspaceId: string;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  chunkIndex: number;
  content: string;
  embeddingVersion: number;
  indexedAt: string;
  createdAt: string;
}

export interface RankedEmbeddingResult extends EmbeddingRecord {
  /** Cosine similarity — higher is more relevant. */
  score: number;
}

export interface IndexContentInput {
  workspaceId: string;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  /** Raw content to chunk and embed. Chunks whose content is unchanged since the last index are not re-embedded. */
  content: string;
}

export interface IndexResult {
  sourceType: EmbeddingSourceType;
  sourceId: string;
  chunksIndexed: number;
  chunksSkipped: number;
  chunksDeleted: number;
}

export interface SemanticSearchQuery {
  workspaceId: string;
  query: string;
  sourceTypes?: EmbeddingSourceType[];
  limit?: number;
}

export interface RetrievalContextQuery {
  workspaceId: string;
  query: string;
  conversationId?: string;
  memoryLimit?: number;
  embeddingLimit?: number;
}

/**
 * Everything retrieved for one query, merged across content types
 * (Phase 3.6 task #201: "merge memories, conversation summaries, related
 * tasks"). Purely advisory — attaching this to a response never itself
 * changes memory, a conversation, or a task.
 */
export interface RetrievedContext {
  memories: RankedMemoryResult[];
  relatedConversations: RankedEmbeddingResult[];
  relatedTasks: RankedEmbeddingResult[];
}

export interface ReindexWorkspaceResult {
  conversations: IndexResult[];
  tasks: IndexResult[];
}
