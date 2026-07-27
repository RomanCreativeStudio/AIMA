import type { EmbeddingProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';
import type { CreateMemoryInput, MemoryRecord, MemorySearchQuery, RankedMemoryResult } from './types';

const DEFAULT_SEARCH_LIMIT = 5;

/**
 * Owns storage and retrieval of memory_records: embedding new memories on
 * write, and ranking by cosine similarity on read. Workspace isolation is
 * enforced here, not left to callers — every method requires a workspaceId
 * and every query filters by it (docs/TECHNICAL_ARCHITECTURE.md §6).
 */
export class MemoryService {
  constructor(
    private readonly db: Queryable,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    assertScopeConsistency(input);

    const [embedding] = await this.embeddingProvider.embed([input.content]);

    const result = await this.db.query(
      `INSERT INTO memory_records
         (workspace_id, scope, content, source, conversation_id, project_key, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector)
       RETURNING id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at`,
      [
        input.workspaceId,
        input.scope,
        input.content,
        input.source ?? null,
        input.conversationId ?? null,
        input.projectKey ?? null,
        JSON.stringify(input.metadata ?? {}),
        toVectorLiteral(embedding),
      ],
    );

    return mapRow(result.rows[0]);
  }

  /** Ranked semantic search within a single workspace, optionally narrowed by scope/conversation/project. */
  async search(query: MemorySearchQuery): Promise<RankedMemoryResult[]> {
    const [embedding] = await this.embeddingProvider.embed([query.query]);
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;

    const conditions = ['workspace_id = $1', 'embedding IS NOT NULL'];
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

    params.push(limit);
    const limitParam = `$${params.length}`;

    const result = await this.db.query(
      `SELECT id, workspace_id, scope, content, source, conversation_id, project_key, metadata, created_at,
              1 - (embedding <=> ${embeddingParam}) AS score
       FROM memory_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY embedding <=> ${embeddingParam}
       LIMIT ${limitParam}`,
      params,
    );

    return result.rows.map((row) => ({ ...mapRow(row), score: Number(row.score) }));
  }

  /** Convenience wrapper for assembling "relevant context for this workspace" — no scope filter. */
  async getWorkspaceContext(workspaceId: string, query: string, limit?: number): Promise<RankedMemoryResult[]> {
    return this.search({ workspaceId, query, limit });
  }
}

function assertScopeConsistency(input: CreateMemoryInput): void {
  if (input.scope === 'conversation' && !input.conversationId) {
    throw new Error('A "conversation" scoped memory requires conversationId.');
  }
  if (input.scope === 'project' && !input.projectKey) {
    throw new Error('A "project" scoped memory requires projectKey.');
  }
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
