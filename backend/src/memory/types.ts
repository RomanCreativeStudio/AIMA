/**
 * The four memory categories from docs/PRODUCT_BIBLE.md, backed by the
 * memory_scope enum in database/migrations/0002_memory_scopes.sql. Every
 * memory still belongs to exactly one workspace — "user" scope means a
 * durable personal-preference fact recorded within that workspace, not a
 * cross-workspace global memory (see the migration's design note).
 */
export const MEMORY_SCOPES = ['user', 'workspace', 'conversation', 'project'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/**
 * The memory lifecycle dimension (Phase 3.4, database/migrations/
 * 0017_memory_intelligence.sql) — orthogonal to `scope`, which answers
 * "which context does this belong to." `short_term` memories are eligible
 * for `expiresAt`-based exclusion from retrieval; `long_term` (the default)
 * never expire on their own.
 */
export const MEMORY_TYPES = ['short_term', 'long_term'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface CreateMemoryInput {
  workspaceId: string;
  scope: MemoryScope;
  content: string;
  source?: string;
  conversationId?: string;
  projectKey?: string;
  metadata?: Record<string, unknown>;
  /** How significant this memory is, in [0, 1]. Defaults to 0.5. */
  importanceScore?: number;
  /** How much the source should be trusted, in [0, 1]. Defaults to 1.0 — a user-authored memory is certain by construction. */
  confidenceScore?: number;
  /** Defaults to 'long_term'. */
  memoryType?: MemoryType;
  /** Only meaningful for `memoryType: 'short_term'`. */
  expiresAt?: string;
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
  importanceScore: number;
  confidenceScore: number;
  memoryType: MemoryType;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
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
  /** Blended relevance score (similarity + importance + confidence — see ./ranking.ts), not raw cosine similarity alone. */
  score: number;
}

export interface ListMemoriesQuery {
  workspaceId: string;
  scope?: MemoryScope;
  memoryType?: MemoryType;
  /** Defaults to false — archived memories are hidden from the default list view, same as search. */
  includeArchived?: boolean;
  limit?: number;
}

export interface UpdateMemoryInput {
  content?: string;
  importanceScore?: number;
  confidenceScore?: number;
  metadata?: Record<string, unknown>;
}
