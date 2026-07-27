import type { AIProvider } from '@aima/ai-engine';
import type { ActionLogger } from '../actionLog/logger';
import type { Queryable } from '../db/queryable';
import type { IntentEngine } from '../intent/intentEngine';
import type { MemoryService } from '../memory/memoryService';
import type { PermissionEngine } from '../permissions/engine';
import { isWorkspaceSlug, type WorkspaceSlug } from '../types/workspace';
import { buildSystemPrompt } from './contextAssembly';
import { ConversationNotFoundError, WorkspaceNotFoundError } from './errors';
import type { Conversation, Message, MessageRole, SendMessageInput, SendMessageResult } from './types';

const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_MEMORY_LIMIT = 5;

export const GENERATE_RESPONSE_CAPABILITY = 'generate_ai_response';

/**
 * The conversation pipeline (docs/TECHNICAL_ARCHITECTURE.md §4, §7):
 *
 *   User Input → Workspace Context → Memory Retrieval → Context Assembly
 *   → AI Provider → Response → Conversation Storage
 *
 * Every step is workspace-scoped: a conversation must belong to the
 * workspace it's addressed through, memory retrieval never crosses
 * workspaces, and history/memory are both capped (context limits) before
 * being sent to the AI provider.
 */
export class ConversationService {
  constructor(
    private readonly db: Queryable,
    private readonly memoryService: MemoryService,
    private readonly aiProvider: AIProvider,
    private readonly actionLogger: ActionLogger,
    private readonly permissionEngine: PermissionEngine,
    private readonly intentEngine: IntentEngine,
    private readonly historyLimit: number = DEFAULT_HISTORY_LIMIT,
    private readonly memoryLimit: number = DEFAULT_MEMORY_LIMIT,
  ) {}

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
   * Runs the full pipeline for one user turn: saves the user message, pulls
   * workspace-scoped memory and recent history, assembles a system prompt,
   * calls the AI provider, saves the assistant's reply, and logs the
   * generation for transparency (docs/PRODUCT_BIBLE.md's Transparency
   * principle) — regardless of outcome.
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const workspaceSlug = await this.assertConversationInWorkspace(input.workspaceId, input.conversationId);

    const userMessage = await this.saveMessage(input.workspaceId, input.conversationId, 'user', input.content);

    try {
      const [history, relevantMemories, intent] = await Promise.all([
        this.listMessages(input.workspaceId, input.conversationId, this.historyLimit),
        this.memoryService.getWorkspaceContext(input.workspaceId, input.content, this.memoryLimit),
        this.intentEngine.analyze(input.content),
      ]);

      const systemPrompt = buildSystemPrompt(workspaceSlug, relevantMemories);

      const completion = await this.aiProvider.complete({
        systemPrompt,
        messages: history.map((message) => ({ role: message.role, content: message.content })),
      });

      const assistantMessage = await this.saveMessage(
        input.workspaceId,
        input.conversationId,
        'assistant',
        completion.content,
      );

      await this.actionLogger.log({
        workspaceId: input.workspaceId,
        tier: this.permissionEngine.resolveTier(GENERATE_RESPONSE_CAPABILITY),
        summary: 'Generated an AI response',
        payload: {
          conversationId: input.conversationId,
          memoriesUsed: relevantMemories.length,
          provider: completion.provider,
          detectedIntent: intent.intent,
          intentConfidence: intent.confidence,
          approval: intent.approval,
        },
        outcome: 'success',
      });

      return { userMessage, assistantMessage, retrievedMemories: relevantMemories, intent };
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
