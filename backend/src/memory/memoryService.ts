import type { EmbeddingProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';
import { toVectorLiteral } from '../db/vector';
import { WorkspaceNotFoundError } from '../types/errors';
import { MemoryNotFoundError } from './errors';
import { rankMemories } from './ranking';
import type {
  CreateMemoryInput,
  ListMemoriesQuery,
  MemoryRecord,
  MemorySearchQuery,
  RankedMemoryResult,
  UpdateMemoryInput,
} from './types';

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 50;
/** How many raw-similarity candidates to pull from the database before re-ranking by blended relevance — wide enough that a highly important/confident memory outside the top-N by similarity alone still has a chance to surface, capped so a poll-shaped query never scans the whole table. */
const CANDIDATE_OVERSAMPLE_FACTOR = 4;
const MAX_CANDIDATES = 50;

/**
 * Owns storage, retrieval, scoring, and lifecycle of memory_records — the
 * Memory Intelligence Layer (Phase 3.4, docs/decisions/
 * 0019-advanced-memory-system.md). Workspace isolation is enforced here,
 * not left to callers — every method requires a workspaceId and every query
 * filters by it (docs/TECHNICAL_ARCHITECTURE.md §6).
 *
 * Every memory created through this service is the result of an explicit
 * caller request (a route handler acting on a real HTTP request, or a
 * workflow step) — nothing in this class ever creates a memory on its own
 * initiative, preserving the "no hidden memory creation" requirement.
 */
export class MemoryService {
  constructor(
    private readonly db: Queryable,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    assertScopeConsistency(input);
    assertUnitInterval('importanceScore', input.importanceScore);
    assertUnitInterval('confidenceScore', input.confidenceScore);
    await this.assertWorkspaceExists(input.workspaceId);

    const [embedding] = await this.embeddingProvider.embed([input.content]);

    const result = await this.db.query<MemoryRow>(
      `INSERT INTO memory_records
         (workspace_id, scope, content, source, conversation_id, project_key, metadata, embedding,
          importance_score, confidence_score, memory_type, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector, $9, $10, $11, $12)
       RETURNING id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
                 importance_score, confidence_score, memory_type, last_accessed_at, expires_at, archived_at`,
      [
        input.workspaceId,
        input.scope,
        input.content,
        input.source ?? null,
        input.conversationId ?? null,
        input.projectKey ?? null,
        JSON.stringify(input.metadata ?? {}),
        toVectorLiteral(embedding),
        input.importanceScore ?? 0.5,
        input.confidenceScore ?? 1.0,
        input.memoryType ?? 'long_term',
        input.expiresAt ?? null,
      ],
    );

    return mapRow(result.rows[0]);
  }

  /**
   * Ranked semantic search within a single workspace, optionally narrowed by
   * scope/conversation/project. Excludes archived memories and expired
   * short-term memories. Candidates are pulled by raw cosine similarity
   * (index-backed), then re-ranked by blended relevance (./ranking.ts) —
   * "context-aware retrieval," not pure textual closeness. Touches
   * `last_accessed_at` on every memory returned.
   */
  async search(query: MemorySearchQuery): Promise<RankedMemoryResult[]> {
    const [embedding] = await this.embeddingProvider.embed([query.query]);
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const candidateLimit = Math.min(limit * CANDIDATE_OVERSAMPLE_FACTOR, MAX_CANDIDATES);

    const conditions = ['workspace_id = $1', 'embedding IS NOT NULL', ...activeMemoryConditions()];
    const params: unknown[] = [query.workspaceId];

    if (query.scope) {
      params.push(query.scope);
      conditions.push(`scope = $${params.length}`);
    }
    if (query.conversationId) {
      params.push(query.conversationId);
      conditions.push(`conversation_id = $${params.length}`);
    }
    if (query.projectKey) {
      params.push(query.projectKey);
      conditions.push(`project_key = $${params.length}`);
    }

    params.push(toVectorLiteral(embedding));
    const embeddingParam = `$${params.length}::vector`;

    params.push(candidateLimit);
    const candidateLimitParam = `$${params.length}`;

    const result = await this.db.query<MemoryRow & { similarity: string }>(
      `SELECT id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
              importance_score, confidence_score, memory_type, last_accessed_at, expires_at, archived_at,
              1 - (embedding <=> ${embeddingParam}) AS similarity
       FROM memory_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY embedding <=> ${embeddingParam}
       LIMIT ${candidateLimitParam}`,
      params,
    );

    const ranked = rankMemories(
      result.rows.map((row) => ({
        row,
        similarity: Number(row.similarity),
        importanceScore: row.importance_score,
        confidenceScore: row.confidence_score,
      })),
    ).slice(0, limit);

    if (ranked.length > 0) {
      await this.touchLastAccessed(ranked.map(({ row }) => row.id));
    }

    return ranked.map(({ row, relevanceScore }) => ({ ...mapRow(row), score: relevanceScore }));
  }

  /** Convenience wrapper for assembling "relevant context for this workspace" — no scope filter. */
  async getWorkspaceContext(workspaceId: string, query: string, limit?: number): Promise<RankedMemoryResult[]> {
    return this.search({ workspaceId, query, limit });
  }

  /** Plain, unscored listing (newest first) for the memory management UI — no embedding call. */
  async listMemories(query: ListMemoriesQuery): Promise<MemoryRecord[]> {
    await this.assertWorkspaceExists(query.workspaceId);

    const conditions = ['workspace_id = $1'];
    const params: unknown[] = [query.workspaceId];

    if (!query.includeArchived) {
      conditions.push('archived_at IS NULL');
    }
    if (query.scope) {
      params.push(query.scope);
      conditions.push(`scope = $${params.length}`);
    }
    if (query.memoryType) {
      params.push(query.memoryType);
      conditions.push(`memory_type = $${params.length}`);
    }

    params.push(query.limit ?? DEFAULT_LIST_LIMIT);
    const limitParam = `$${params.length}`;

    const result = await this.db.query<MemoryRow>(
      `SELECT id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
              importance_score, confidence_score, memory_type, last_accessed_at, expires_at, archived_at
       FROM memory_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limitParam}`,
      params,
    );

    return result.rows.map(mapRow);
  }

  /** Beta Tester Infrastructure sprint: total non-archived memories ever created in this workspace — the "memories created" usage signal. Uncapped, unlike `listMemories` (which caps at `DEFAULT_LIST_LIMIT`), so a plain `COUNT`, not `.length`. */
  async countMemories(workspaceId: string): Promise<number> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM memory_records WHERE workspace_id = $1 AND archived_at IS NULL`,
      [workspaceId],
    );
    return Number(result.rows[0].count);
  }

  async getMemory(workspaceId: string, memoryId: string): Promise<MemoryRecord> {
    const result = await this.db.query<MemoryRow>(
      `SELECT id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
              importance_score, confidence_score, memory_type, last_accessed_at, expires_at, archived_at
       FROM memory_records WHERE id = $1 AND workspace_id = $2`,
      [memoryId, workspaceId],
    );
    if (result.rows.length === 0) {
      throw new MemoryNotFoundError(memoryId, workspaceId);
    }
    return mapRow(result.rows[0]);
  }

  /**
   * Edits content/scores/metadata on an existing memory — an explicit user
   * action (e.g. correcting a saved fact, or adjusting confidence after
   * finding it was wrong). Re-embeds only when `content` actually changes.
   */
  async updateMemory(workspaceId: string, memoryId: string, input: UpdateMemoryInput): Promise<MemoryRecord> {
    assertUnitInterval('importanceScore', input.importanceScore);
    assertUnitInterval('confidenceScore', input.confidenceScore);
    const existing = await this.getMemory(workspaceId, memoryId);

    const content = input.content ?? existing.content;
    const embedding =
      input.content !== undefined && input.content !== existing.content
        ? (await this.embeddingProvider.embed([content]))[0]
        : null;

    const result = await this.db.query<MemoryRow>(
      `UPDATE memory_records
       SET content = $1,
           importance_score = $2,
           confidence_score = $3,
           metadata = $4::jsonb,
           embedding = COALESCE($5::vector, embedding)
       WHERE id = $6 AND workspace_id = $7
       RETURNING id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
                 importance_score, confidence_score, memory_type, last_accessed_at, expires_at, archived_at`,
      [
        content,
        input.importanceScore ?? existing.importanceScore,
        input.confidenceScore ?? existing.confidenceScore,
        JSON.stringify(input.metadata ?? existing.metadata),
        embedding ? toVectorLiteral(embedding) : null,
        memoryId,
        workspaceId,
      ],
    );

    return mapRow(result.rows[0]);
  }

  /** Soft-delete: excluded from search/list by default, but not destroyed — distinct from `deleteMemory`. */
  async archiveMemory(workspaceId: string, memoryId: string): Promise<MemoryRecord> {
    await this.getMemory(workspaceId, memoryId);
    const result = await this.db.query<MemoryRow>(
      `UPDATE memory_records SET archived_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
                 importance_score, confidence_score, memory_type, last_accessed_at, expires_at, archived_at`,
      [memoryId, workspaceId],
    );
    return mapRow(result.rows[0]);
  }

  /** Hard delete — permanent, unlike `archiveMemory`. */
  async deleteMemory(workspaceId: string, memoryId: string): Promise<void> {
    await this.getMemory(workspaceId, memoryId);
    await this.db.query('DELETE FROM memory_records WHERE id = $1 AND workspace_id = $2', [memoryId, workspaceId]);
  }

  private async touchLastAccessed(memoryIds: string[]): Promise<void> {
    await this.db.query('UPDATE memory_records SET last_accessed_at = now() WHERE id = ANY($1::uuid[])', [
      memoryIds,
    ]);
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

function activeMemoryConditions(): string[] {
  return ['archived_at IS NULL', "(memory_type = 'long_term' OR expires_at IS NULL OR expires_at > now())"];
}

function assertScopeConsistency(input: CreateMemoryInput): void {
  if (input.scope === 'conversation' && !input.conversationId) {
    throw new Error('A "conversation" scoped memory requires conversationId.');
  }
  if (input.scope === 'project' && !input.projectKey) {
    throw new Error('A "project" scoped memory requires projectKey.');
  }
}

function assertUnitInterval(name: string, value: number | undefined): void {
  if (value !== undefined && (value < 0 || value > 1)) {
    throw new Error(`${name} must be between 0 and 1 (got ${value}).`);
  }
}

interface MemoryRow {
  id: string;
  workspace_id: string;
  scope: MemoryRecord['scope'];
  content: string;
  source: string | null;
  conversation_id: string | null;
  project_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  importance_score: number;
  confidence_score: number;
  memory_type: MemoryRecord['memoryType'];
  last_accessed_at: Date | string | null;
  expires_at: Date | string | null;
  archived_at: Date | string | null;
}

function mapRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    scope: row.scope,
    content: row.content,
    source: row.source,
    conversationId: row.conversation_id,
    projectKey: row.project_key,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at),
    importanceScore: Number(row.importance_score),
    confidenceScore: Number(row.confidence_score),
    memoryType: row.memory_type,
    lastAccessedAt: row.last_accessed_at === null ? null : toIso(row.last_accessed_at),
    expiresAt: row.expires_at === null ? null : toIso(row.expires_at),
    archivedAt: row.archived_at === null ? null : toIso(row.archived_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
