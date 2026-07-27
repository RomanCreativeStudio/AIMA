import type { ActionLogger } from '../actionLog/logger';
import type { AimaCoreService } from '../core/aimaCoreService';
import type { Queryable } from '../db/queryable';
import type { PermissionEngine } from '../permissions/engine';
import { isWorkspaceSlug, type WorkspaceSlug } from '../types/workspace';
import { WorkspaceNotFoundError } from '../types/errors';
import { ConversationNotFoundError } from './errors';
import type { Conversation, Message, MessageRole, SendMessageInput, SendMessageResult } from './types';

const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_DOCUMENT_LIMIT = 5;

export const GENERATE_RESPONSE_CAPABILITY = 'generate_ai_response';

export interface ConversationServiceDependencies {
  db: Queryable;
  aimaCoreService: AimaCoreService;
  actionLogger: ActionLogger;
  permissionEngine: PermissionEngine;
  /** Max recent messages sent to the AI provider (a context limit — count-based, not token-based). */
  historyLimit?: number;
  /** Max memory records retrieved per turn (a context limit). */
  memoryLimit?: number;
  /** Max document chunks retrieved per turn (a context limit). */
  documentLimit?: number;
}

/**
 * Owns conversation persistence and workspace isolation
 * (docs/TECHNICAL_ARCHITECTURE.md §6): creating conversations, saving/
 * loading messages, and confirming a conversation belongs to the workspace
 * it's addressed through before anything else happens. The actual "figure
 * out what AIMA should say" work — gathering context, detecting intent,
 * calling the AI provider — is delegated to `AimaCoreService` (Phase 1.6),
 * the orchestration layer (docs/decisions/0006-assistant-core-
 * orchestration.md). This split means AimaCoreService can be reused by
 * anything that needs a workspace-aware AI response without a persisted
 * conversation.
 */
export class ConversationService {
  private readonly db: Queryable;
  private readonly aimaCoreService: AimaCoreService;
  private readonly actionLogger: ActionLogger;
  private readonly permissionEngine: PermissionEngine;
  private readonly historyLimit: number;
  private readonly memoryLimit: number;
  private readonly documentLimit: number;

  constructor(deps: ConversationServiceDependencies) {
    this.db = deps.db;
    this.aimaCoreService = deps.aimaCoreService;
    this.actionLogger = deps.actionLogger;
    this.permissionEngine = deps.permissionEngine;
    this.historyLimit = deps.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.memoryLimit = deps.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    this.documentLimit = deps.documentLimit ?? DEFAULT_DOCUMENT_LIMIT;
  }

  async createConversation(workspaceId: string, title?: string): Promise<Conversation> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query(
      `INSERT INTO conversations (workspace_id, title)
       VALUES ($1, $2)
       RETURNING id, workspace_id, title, created_at, updated_at`,
      [workspaceId, title ?? null],
    );

    return mapConversationRow(result.rows[0]);
  }

  /**
   * Most-recently-active conversation first (Phase 2.1, macOS Chat screen's
   * conversation list). Ordered by the monotonic `sequence` column, not
   * `updated_at` — under READ COMMITTED, `now()` is frozen at transaction
   * start, so two conversations touched in the same transaction could tie
   * on `updated_at` (the same problem `database/migrations/
   * 0003_message_sequence.sql` solved for `messages`).
   */
  async listConversations(workspaceId: string): Promise<Conversation[]> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query(
      `SELECT id, workspace_id, title, created_at, updated_at
       FROM conversations
       WHERE workspace_id = $1
       ORDER BY sequence DESC`,
      [workspaceId],
    );

    return result.rows.map(mapConversationRow);
  }

  /** Most-recent-first is how it's queried; returned oldest-first, as a model expects conversation turns. */
  async listMessages(workspaceId: string, conversationId: string, limit: number = this.historyLimit): Promise<Message[]> {
    await this.assertConversationInWorkspace(workspaceId, conversationId);

    const result = await this.db.query(
      `SELECT id, conversation_id, workspace_id, role, content, created_at
       FROM messages
       WHERE conversation_id = $1 AND workspace_id = $2
       ORDER BY sequence DESC
       LIMIT $3`,
      [conversationId, workspaceId, limit],
    );

    return result.rows.map(mapMessageRow).reverse();
  }

  /**
   * Runs one user turn: saves the user message, hands off to
   * AimaCoreService for context gathering + intent detection + the AI
   * call, saves the assistant's reply, and logs the generation for
   * transparency (docs/PRODUCT_BIBLE.md's Transparency principle) —
   * regardless of outcome.
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const workspaceSlug = await this.assertConversationInWorkspace(input.workspaceId, input.conversationId);

    const userMessage = await this.saveMessage(input.workspaceId, input.conversationId, 'user', input.content);
    await this.touchConversation(input.conversationId);

    try {
      const history = await this.listMessages(input.workspaceId, input.conversationId, this.historyLimit);

      const result = await this.aimaCoreService.handleRequest({
        workspaceId: input.workspaceId,
        workspaceSlug,
        query: input.content,
        history,
        limits: { memoryLimit: this.memoryLimit, documentLimit: this.documentLimit },
      });

      const assistantMessage = await this.saveMessage(
        input.workspaceId,
        input.conversationId,
        'assistant',
        result.content,
      );

      await this.actionLogger.log({
        workspaceId: input.workspaceId,
        tier: this.permissionEngine.resolveTier(GENERATE_RESPONSE_CAPABILITY),
        summary: 'Generated an AI response',
        payload: {
          conversationId: input.conversationId,
          memoriesUsed: result.context.memories.length,
          documentChunksUsed: result.context.documentChunks.length,
          provider: result.provider,
          detectedIntent: result.intent.intent,
          intentConfidence: result.intent.confidence,
          approval: result.intent.approval,
          approvalDecision: result.approvalDecision.state,
        },
        outcome: 'success',
      });

      return {
        userMessage,
        assistantMessage,
        retrievedMemories: result.context.memories,
        retrievedDocumentChunks: result.context.documentChunks,
        intent: result.intent,
        approvalDecision: result.approvalDecision,
      };
    } catch (error) {
      await this.actionLogger.log({
        workspaceId: input.workspaceId,
        tier: this.permissionEngine.resolveTier(GENERATE_RESPONSE_CAPABILITY),
        summary: 'Failed to generate an AI response',
        payload: { conversationId: input.conversationId, error: (error as Error).message },
        outcome: 'failure',
      });
      throw error;
    }
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }

  /** Returns the workspace's slug once confirmed the conversation belongs to it — the isolation checkpoint. */
  private async assertConversationInWorkspace(workspaceId: string, conversationId: string): Promise<WorkspaceSlug> {
    const result = await this.db.query(
      `SELECT w.slug
       FROM conversations c
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = $1 AND c.workspace_id = $2`,
      [conversationId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new ConversationNotFoundError(conversationId, workspaceId);
    }

    const slug = result.rows[0].slug as string;
    if (!isWorkspaceSlug(slug)) {
      throw new Error(`Unknown workspace slug: ${slug}`);
    }

    return slug;
  }

  /** `sequence = DEFAULT` re-evaluates the column's nextval() default, bumping it — the actual signal `listConversations` orders by. */
  private async touchConversation(conversationId: string): Promise<void> {
    await this.db.query('UPDATE conversations SET updated_at = now(), sequence = DEFAULT WHERE id = $1', [
      conversationId,
    ]);
  }

  private async saveMessage(
    workspaceId: string,
    conversationId: string,
    role: MessageRole,
    content: string,
  ): Promise<Message> {
    const result = await this.db.query(
      `INSERT INTO messages (conversation_id, workspace_id, role, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, workspace_id, role, content, created_at`,
      [conversationId, workspaceId, role, content],
    );

    return mapMessageRow(result.rows[0]);
  }
}

interface ConversationRow {
  id: string;
  workspace_id: string;
  title: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  workspace_id: string;
  role: MessageRole;
  content: string;
  created_at: Date | string;
}

function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    workspaceId: row.workspace_id,
    role: row.role,
    content: row.content,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
