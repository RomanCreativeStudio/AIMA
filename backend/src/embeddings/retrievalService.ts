import type { EmbeddingProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';
import { toVectorLiteral } from '../db/vector';
import type { MemoryService } from '../memory/memoryService';
import { WorkspaceNotFoundError } from '../types/errors';
import type { EmbeddingService } from './embeddingService';
import type {
  EmbeddingSourceType,
  IndexResult,
  RankedEmbeddingResult,
  ReindexWorkspaceResult,
  RetrievalContextQuery,
  RetrievedContext,
  SemanticSearchQuery,
} from './types';

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_EMBEDDING_CONTEXT_LIMIT = 5;
/** How many of a conversation's most recent messages become that conversation's indexable content — a context window, not a hard cap on conversation length. */
const CONVERSATION_CONTENT_MESSAGE_LIMIT = 50;

/**
 * Read side of semantic retrieval (Phase 3.6, docs/decisions/
 * 0021-semantic-search-and-context-retrieval.md): ranked similarity search
 * over the generic `embeddings` table, advisory context assembly across
 * memories/conversations/tasks, and workspace-wide re-indexing.
 *
 * Deliberately depends on `db: Queryable` directly for conversations/tasks
 * rather than on `ConversationService`/`TaskService` — `ConversationService`
 * depends on this class (to attach `retrievedContext` to `SendMessageResult`),
 * so depending back on it here would create a circular dependency. A
 * conversation's indexable content is a deterministic concatenation of its
 * recent messages, never an AI-generated summary — this class never calls
 * an AI provider, only the injected `EmbeddingProvider`/`EmbeddingService`/
 * `MemoryService` abstractions. Retrieval only: nothing here writes a
 * memory, a conversation, or a task.
 */
export class RetrievalService {
  constructor(
    private readonly db: Queryable,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly embeddingService: EmbeddingService,
    private readonly memoryService: MemoryService,
  ) {}

  async search(query: SemanticSearchQuery): Promise<RankedEmbeddingResult[]> {
    await this.assertWorkspaceExists(query.workspaceId);

    const [embedding] = await this.embeddingProvider.embed([query.query]);
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;

    const conditions = ['workspace_id = $1'];
    const params: unknown[] = [query.workspaceId];

    if (query.sourceTypes && query.sourceTypes.length > 0) {
      params.push(query.sourceTypes);
      conditions.push(`source_type::text = ANY($${params.length}::text[])`);
    }

    params.push(toVectorLiteral(embedding));
    const embeddingParam = `$${params.length}::vector`;

    params.push(limit);
    const limitParam = `$${params.length}`;

    const result = await this.db.query<EmbeddingRow & { similarity: string }>(
      `SELECT id, workspace_id, source_type, source_id, chunk_index, content, embedding_version, indexed_at, created_at,
              1 - (embedding <=> ${embeddingParam}) AS similarity
       FROM embeddings
       WHERE ${conditions.join(' AND ')}
       ORDER BY embedding <=> ${embeddingParam}
       LIMIT ${limitParam}`,
      params,
    );

    return result.rows.map((row) => ({ ...mapEmbeddingRow(row), score: Number(row.similarity) }));
  }

  /**
   * Merges memories, related conversations, and related tasks for one
   * query — the advisory `retrievedContext` shape (task #201). Never
   * modifies memory or writes anything; a pure read across three sources.
   */
  async getContext(query: RetrievalContextQuery): Promise<RetrievedContext> {
    await this.assertWorkspaceExists(query.workspaceId);

    const memoryLimit = query.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    const embeddingLimit = query.embeddingLimit ?? DEFAULT_EMBEDDING_CONTEXT_LIMIT;

    const [memories, relatedConversations, relatedTasks] = await Promise.all([
      this.memoryService.getWorkspaceContext(query.workspaceId, query.query, memoryLimit),
      this.search({ workspaceId: query.workspaceId, query: query.query, sourceTypes: ['conversation'], limit: embeddingLimit }),
      this.search({ workspaceId: query.workspaceId, query: query.query, sourceTypes: ['task'], limit: embeddingLimit }),
    ]);

    return { memories, relatedConversations, relatedTasks };
  }

  /**
   * Re-indexes every conversation and task in a workspace — an explicit,
   * caller-triggered action (the reindex route), never run automatically.
   */
  async reindexWorkspace(workspaceId: string): Promise<ReindexWorkspaceResult> {
    await this.assertWorkspaceExists(workspaceId);

    const conversations = await this.db.query<{ id: string }>(
      'SELECT id FROM conversations WHERE workspace_id = $1',
      [workspaceId],
    );
    const conversationResults: IndexResult[] = [];
    for (const { id } of conversations.rows) {
      const content = await this.buildConversationContent(workspaceId, id);
      if (content.trim().length === 0) {
        continue;
      }
      conversationResults.push(
        await this.embeddingService.indexContent({ workspaceId, sourceType: 'conversation', sourceId: id, content }),
      );
    }

    const tasks = await this.db.query<{ id: string; title: string; description: string | null }>(
      'SELECT id, title, description FROM tasks WHERE workspace_id = $1',
      [workspaceId],
    );
    const taskResults: IndexResult[] = [];
    for (const task of tasks.rows) {
      const content = [task.title, task.description].filter((part): part is string => Boolean(part)).join('\n\n');
      if (content.trim().length === 0) {
        continue;
      }
      taskResults.push(
        await this.embeddingService.indexContent({ workspaceId, sourceType: 'task', sourceId: task.id, content }),
      );
    }

    return { conversations: conversationResults, tasks: taskResults };
  }

  /** Deterministic concatenation of a conversation's recent messages — not an AI-generated summary. */
  private async buildConversationContent(workspaceId: string, conversationId: string): Promise<string> {
    const result = await this.db.query<{ role: string; content: string }>(
      `SELECT role, content FROM messages
       WHERE workspace_id = $1 AND conversation_id = $2
       ORDER BY sequence DESC
       LIMIT $3`,
      [workspaceId, conversationId, CONVERSATION_CONTENT_MESSAGE_LIMIT],
    );
    return result.rows
      .reverse()
      .map((row) => `${row.role}: ${row.content}`)
      .join('\n');
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface EmbeddingRow {
  id: string;
  workspace_id: string;
  source_type: EmbeddingSourceType;
  source_id: string;
  chunk_index: number;
  content: string;
  embedding_version: number;
  indexed_at: Date | string;
  created_at: Date | string;
}

function mapEmbeddingRow(row: EmbeddingRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    embeddingVersion: row.embedding_version,
    indexedAt: toIso(row.indexed_at),
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
