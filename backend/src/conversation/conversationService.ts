import type { ActionCandidateCategory, ActionDetector, MemoryCandidate, MemoryCandidateCategory, MemoryExtractor } from '@aima/ai-engine';
import { RuleBasedActionDetector, RuleBasedMemoryExtractor } from '@aima/ai-engine';
import type { ActionLogger } from '../actionLog/logger';
import type { AimaCoreService } from '../core/aimaCoreService';
import type { Queryable } from '../db/queryable';
import type { RetrievalService } from '../embeddings/retrievalService';
import { isOpenTask } from '../insights/taskAnalysis';
import type { MemoryService } from '../memory/memoryService';
import type { PermissionEngine } from '../permissions/engine';
import type { TaskService } from '../tasks/taskService';
import type { Task } from '../tasks/types';
import { isWorkspaceSlug, type WorkspaceSlug } from '../types/workspace';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkflowIntentMatcher } from '../workflows/workflowIntentMatcher';
import type { ExecutionIntentMatcher } from '../execution/executionIntentMatcher';
import { buildActionSuggestions } from './actionSuggestions';
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
  /** Pure phrase-matching against the built-in workflows (Phase 2.4) — never creates or executes a run, only shapes the advisory `workflowSuggestion` on the response. */
  workflowIntentMatcher: WorkflowIntentMatcher;
  /** Pure phrase-matching against real external actions (Phase 2.6) — never creates or executes anything, only shapes the advisory `executionSuggestion` on the response. */
  executionIntentMatcher: ExecutionIntentMatcher;
  /** Detects candidate facts/preferences worth remembering (Phase 3.4) — advisory only, shapes `memorySuggestions` on the response; never creates a memory itself. Optional, defaulting to `RuleBasedMemoryExtractor` — the same "no live network call" default as every other rule-based matcher in this pipeline. */
  memoryExtractor?: MemoryExtractor;
  /** Detects candidate todo/follow-up/meeting items (Conversation → Action sprint) — advisory only, shapes `actionSuggestions` on the response together with the reminder/decision candidates `memoryExtractor` already found; never creates a task itself. Optional, defaulting to `RuleBasedActionDetector`. */
  actionDetector?: ActionDetector;
  /** Computes the advisory `retrievedContext` (Phase 3.6) — merged memories/conversations/tasks for this turn. Optional so every pre-existing call site keeps compiling; `retrievedContext` is simply `null` when omitted. Never wired into the AI prompt itself. */
  retrievalService?: RetrievalService;
  /** Personal Workspace Memory sprint: when provided, `sendMessage` auto-saves extracted candidates whose category is in `AUTO_SAVE_CATEGORIES` via `MemoryService.createMemory` — the same memory pipeline `RetrievalService`/the memory routes already use, not a second one. Optional so every pre-existing call site (which never saw memories auto-created) keeps compiling unchanged; auto-save is simply skipped when omitted. */
  memoryService?: MemoryService;
  /** Executive Assistant Loop sprint: when provided, `sendMessage` fetches this workspace's open tasks (via `TaskService.listTasks`, filtered by the already-exported `isOpenTask`) so `buildActionSuggestions` can resolve `matchedTaskId` for completed/blocked/postponed/delegated candidates — the same `TaskService` every other task read/write already uses, not a second one. Fetched only when a candidate actually needs matching, so an ordinary chat turn never pays for the extra query. Optional so every pre-existing call site keeps compiling; `matchedTaskId` is simply always `null` when omitted. */
  taskService?: TaskService;
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
  /** Candidate categories `sendMessage` auto-saves as memories rather than leaving purely advisory — everything else (currently just `fact`) still only ever surfaces as a `memorySuggestions` entry. */
  private static readonly AUTO_SAVE_CATEGORIES: ReadonlySet<MemoryCandidateCategory> = new Set([
    'preference',
    'completed_task',
    'decision',
    'reminder',
    'project_update',
  ]);
  /** How many recent memories to check content against before auto-saving, to avoid saving the same outcome twice. */
  private static readonly DUPLICATE_CHECK_LIMIT = 200;
  /** `ActionCandidate` categories that reference an existing open task — see `taskService`'s doc comment. */
  private static readonly TASK_REFERENCING_ACTION_CATEGORIES: ReadonlySet<ActionCandidateCategory> = new Set([
    'blocked',
    'postponed',
    'delegated',
  ]);

  private readonly db: Queryable;
  private readonly aimaCoreService: AimaCoreService;
  private readonly actionLogger: ActionLogger;
  private readonly permissionEngine: PermissionEngine;
  private readonly workflowIntentMatcher: WorkflowIntentMatcher;
  private readonly executionIntentMatcher: ExecutionIntentMatcher;
  private readonly memoryExtractor: MemoryExtractor;
  private readonly actionDetector: ActionDetector;
  private readonly retrievalService: RetrievalService | null;
  private readonly memoryService: MemoryService | null;
  private readonly taskService: TaskService | null;
  private readonly historyLimit: number;
  private readonly memoryLimit: number;
  private readonly documentLimit: number;

  constructor(deps: ConversationServiceDependencies) {
    this.db = deps.db;
    this.aimaCoreService = deps.aimaCoreService;
    this.actionLogger = deps.actionLogger;
    this.permissionEngine = deps.permissionEngine;
    this.workflowIntentMatcher = deps.workflowIntentMatcher;
    this.executionIntentMatcher = deps.executionIntentMatcher;
    this.memoryExtractor = deps.memoryExtractor ?? new RuleBasedMemoryExtractor();
    this.actionDetector = deps.actionDetector ?? new RuleBasedActionDetector();
    this.retrievalService = deps.retrievalService ?? null;
    this.memoryService = deps.memoryService ?? null;
    this.taskService = deps.taskService ?? null;
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

  /** Beta Tester Infrastructure sprint: total user-authored messages ever sent in this workspace — the "messages sent" usage signal. Unlike `listMessages`, uncapped and workspace-wide (not scoped to one conversation), so a plain `COUNT`, not a `.length` over a limited list. */
  async countMessages(workspaceId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM messages WHERE workspace_id = $1 AND role = 'user'`,
      [workspaceId],
    );
    return Number(result.rows[0].count);
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

      const retrievedContext = this.retrievalService
        ? await this.retrievalService.getContext({
            workspaceId: input.workspaceId,
            query: input.content,
            conversationId: input.conversationId,
          })
        : null;

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

      const candidates = this.memoryExtractor.extract(input.content);
      const { advisory } = await this.autoSaveMemories(input.workspaceId, input.conversationId, candidates);
      const actionCandidates = this.actionDetector.detect(input.content);
      const openTasks = await this.loadOpenTasksIfNeeded(input.workspaceId, actionCandidates, candidates);
      const actionSuggestions = buildActionSuggestions(actionCandidates, candidates, openTasks);

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
        workflowSuggestion: this.workflowIntentMatcher.match(input.content),
        executionSuggestion: this.executionIntentMatcher.match(input.content),
        memorySuggestions: advisory,
        actionSuggestions,
        retrievedContext,
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

  /**
   * Splits extracted candidates into ones this turn auto-saves as memories
   * (`AUTO_SAVE_CATEGORIES`) and ones that stay advisory-only (currently just
   * `fact`), then saves the eligible ones via `MemoryService.createMemory` —
   * the same memory pipeline every other caller uses, not a second one.
   * Skips a candidate whose content already matches an existing memory
   * (case-insensitive, trimmed) to avoid re-saving the same outcome every
   * turn it's restated. Never throws: a failed auto-save must not fail the
   * chat turn, so every candidate falls back to advisory on error.
   */
  private async autoSaveMemories(
    workspaceId: string,
    conversationId: string,
    candidates: MemoryCandidate[],
  ): Promise<{ autoSaved: MemoryCandidate[]; advisory: MemoryCandidate[] }> {
    if (!this.memoryService) {
      return { autoSaved: [], advisory: candidates };
    }

    const eligible = candidates.filter((c) => ConversationService.AUTO_SAVE_CATEGORIES.has(c.category));
    const advisory = candidates.filter((c) => !ConversationService.AUTO_SAVE_CATEGORIES.has(c.category));

    if (eligible.length === 0) {
      return { autoSaved: [], advisory };
    }

    try {
      const existing = await this.memoryService.listMemories({
        workspaceId,
        limit: ConversationService.DUPLICATE_CHECK_LIMIT,
      });
      const seen = new Set(existing.map((m) => normalizeMemoryContent(m.content)));

      const autoSaved: MemoryCandidate[] = [];
      for (const candidate of eligible) {
        const normalized = normalizeMemoryContent(candidate.content);
        if (seen.has(normalized)) {
          continue;
        }
        await this.memoryService.createMemory({
          workspaceId,
          scope: 'conversation',
          content: candidate.content,
          source: 'auto_extracted',
          conversationId,
          metadata: { category: candidate.category, confidence: candidate.confidence, reason: candidate.reason },
          importanceScore: candidate.importance,
          confidenceScore: candidate.confidence,
        });
        seen.add(normalized);
        autoSaved.push(candidate);
      }

      return { autoSaved, advisory };
    } catch {
      return { autoSaved: [], advisory: candidates };
    }
  }

  /**
   * Fetches this turn's open tasks for `buildActionSuggestions`'
   * `matchedTaskId` resolution — but only when at least one candidate
   * actually needs it (a task-referencing `ActionCandidate` category, or a
   * `completed_task` `MemoryCandidate`), so an ordinary chat turn with no
   * such candidate never pays for the extra query. Never throws: a failed
   * fetch degrades to no matching rather than failing the chat turn.
   */
  private async loadOpenTasksIfNeeded(
    workspaceId: string,
    actionCandidates: readonly { category: ActionCandidateCategory }[],
    memoryCandidates: readonly MemoryCandidate[],
  ): Promise<Task[]> {
    if (!this.taskService) {
      return [];
    }

    const needsTaskMatch =
      actionCandidates.some((c) => ConversationService.TASK_REFERENCING_ACTION_CATEGORIES.has(c.category)) ||
      memoryCandidates.some((c) => c.category === 'completed_task');

    if (!needsTaskMatch) {
      return [];
    }

    try {
      const tasks = await this.taskService.listTasks(workspaceId);
      return tasks.filter(isOpenTask);
    } catch {
      return [];
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

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase();
}
