/**
 * The four memory categories from docs/PRODUCT_BIBLE.md, backed by the
 * memory_scope enum in database/migrations/0002_memory_scopes.sql. Every
 * memory still belongs to exactly one workspace — "user" scope means a
 * durable personal-preference fact recorded within that workspace, not a
 * cross-workspace global memory (see the migration's design note).
 */
export const MEMORY_SCOPES = ['user', 'workspace', 'conversation', 'project'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export interface CreateMemoryInput {
  workspaceId: string;
  scope: MemoryScope;
  content: string;
  source?: string;
  conversationId?: string;
  projectKey?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  scope: MemoryScope;
  content: string;
  source: string | null;
  conversationId: string | null;
  projectKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MemorySearchQuery {
  workspaceId: string;
  query: string;
  scope?: MemoryScope;
  conversationId?: string;
  projectKey?: string;
  limit?: number;
}

export interface RankedMemoryResult extends MemoryRecord {
  /** Cosine similarity in [-1, 1] (typically [0, 1] for text embeddings) — higher is more relevant. */
  score: number;
}
