import type { Message } from '../conversation/types';
import { isRecentDecision } from '../insights/briefingService';
import { isOpenTask, rankTasksByPriority } from '../insights/taskAnalysis';
import type { DocumentService } from '../knowledge/documentService';
import type { MemoryRecord, RankedMemoryResult } from '../memory/types';
import type { MemoryService } from '../memory/memoryService';
import type { PreferenceService } from '../preferences/preferenceService';
import type { TaskService } from '../tasks/taskService';
import type { WorkspaceSlug } from '../types/workspace';
import type { ContextLimits, UnifiedContext } from './types';

const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_DOCUMENT_LIMIT = 5;
const DEFAULT_TASK_LIMIT = 5;
const DEFAULT_DECISION_LIMIT = 5;
/** How many recent memories to scan for `isRecentDecision` candidates before deduplication — mirrors `BriefingService`'s `DEFAULT_MEMORY_FETCH_LIMIT` role. */
const DECISION_SCAN_LIMIT = 20;
/** Matches `TaskIntelligenceService`/`BriefingService`'s default — an open task due within 3 days ranks above one with no due date at the same priority. */
const DEFAULT_DUE_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The Unified Context Manager (Phase 1.6): combines conversation history,
 * memory, document, workspace preference (Phase 1.8), and (Context Assembly
 * Engine sprint) open-task and recent-decision context for one AI request,
 * with configurable limits where retrieval can grow unbounded. Extracted
 * out of ConversationService so context gathering is independently
 * testable and reusable by anything else that needs "what does AIMA
 * currently know that's relevant to this workspace and query" — not just
 * the chat pipeline.
 *
 * History is accepted pre-fetched rather than queried here: loading and
 * capping conversation history is a persistence concern that belongs to
 * whichever service owns the `messages` table (ConversationService), not
 * to context assembly. "Current workspace" (the sprint's other named
 * context source) is likewise not gathered here — it's already injected via
 * `buildEffectiveProfile`/the profile's workspace line in
 * `contextAssembly.ts#buildSystemPrompt`, an audit finding rather than new
 * code.
 */
export class ContextManager {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly documentService: DocumentService,
    private readonly preferenceService: PreferenceService,
    /** Context Assembly Engine sprint: when provided, `gatherContext` ranks this workspace's open tasks into `UnifiedContext.tasks`. Optional so every pre-existing call site keeps compiling; `tasks` is simply empty when omitted. */
    private readonly taskService?: TaskService,
  ) {}

  async gatherContext(
    workspaceId: string,
    workspaceSlug: WorkspaceSlug,
    query: string,
    history: Message[],
    limits: ContextLimits = {},
  ): Promise<UnifiedContext> {
    const memoryLimit = limits.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    const documentLimit = limits.documentLimit ?? DEFAULT_DOCUMENT_LIMIT;
    const taskLimit = limits.taskLimit ?? DEFAULT_TASK_LIMIT;
    const decisionLimit = limits.decisionLimit ?? DEFAULT_DECISION_LIMIT;

    const [memories, documentChunks, preferences, openTasks, decisionCandidates] = await Promise.all([
      this.memoryService.getWorkspaceContext(workspaceId, query, memoryLimit),
      this.documentService.search(workspaceId, query, documentLimit),
      this.preferenceService.listPreferences(workspaceId),
      this.taskService
        ? this.taskService.listTasks(workspaceId).then((tasks) => tasks.filter(isOpenTask))
        : Promise.resolve([]),
      this.memoryService
        .listMemories({ workspaceId, limit: DECISION_SCAN_LIMIT })
        .then((records) => records.filter(isRecentDecision)),
    ]);

    const tasks = rankTasksByPriority(openTasks, new Date(), DEFAULT_DUE_SOON_WINDOW_MS).slice(0, taskLimit);
    const decisions = deduplicateDecisions(decisionCandidates, memories).slice(0, decisionLimit);

    return { workspaceSlug, history, memories, documentChunks, preferences, tasks, decisions };
  }
}

/**
 * Excludes any decision memory already present in the relevance-ranked
 * `memories` list (matched by id) — the same fact must never appear in both
 * the "Relevant memory" and "Recent decisions" prompt sections just because
 * two independent gathers both happened to surface it. Exported for direct
 * unit testing, mirroring `taskAnalysis.ts`/`briefingService.ts`'s posture.
 */
export function deduplicateDecisions(
  decisions: readonly MemoryRecord[],
  memories: readonly RankedMemoryResult[],
): MemoryRecord[] {
  const seen = new Set(memories.map((memory) => memory.id));
  return decisions.filter((decision) => !seen.has(decision.id));
}
