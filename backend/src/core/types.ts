import type { Message } from '../conversation/types';
import type { RankedDocumentChunkResult } from '../knowledge/types';
import type { MemoryRecord, RankedMemoryResult } from '../memory/types';
import type { Preference } from '../preferences/types';
import type { Task } from '../tasks/types';
import type { WorkspaceSlug } from '../types/workspace';

/** The Unified Context Manager's output (Phase 1.6): everything gathered for one AI request. */
export interface UnifiedContext {
  workspaceSlug: WorkspaceSlug;
  /** Recent conversation turns, oldest first, already capped by the caller (a persistence concern). */
  history: Message[];
  memories: RankedMemoryResult[];
  documentChunks: RankedDocumentChunkResult[];
  /** All structured preferences for the workspace (Phase 1.8) — small and curated, so unlike memory/documents this is never limit-capped. */
  preferences: Preference[];
  /**
   * Context Assembly Engine sprint: this workspace's open tasks, ranked by
   * `taskAnalysis.ts#rankTasksByPriority` (the same scoring
   * `BriefingService`/`TaskIntelligenceService` already use) — overdue tasks
   * always rank first by that function's existing design, so this single
   * list covers both "open tasks" and "overdue tasks" without a second,
   * separately-ranked list. Empty when no `taskService` was configured.
   */
  tasks: Task[];
  /**
   * Context Assembly Engine sprint: auto-extracted decision memories
   * (`briefingService.ts#isRecentDecision`, reused as-is), newest first,
   * with any memory already present in `memories` excluded — see
   * `contextManager.ts#deduplicateDecisions`. Never empty just because
   * `memories` is empty; the two lists are independently sourced.
   */
  decisions: MemoryRecord[];
}

export interface ContextLimits {
  /** Max memory records retrieved (a context limit — count-based, not token-based). */
  memoryLimit?: number;
  /** Max document chunks retrieved (a context limit). */
  documentLimit?: number;
  /** Context Assembly Engine sprint: max ranked open tasks injected into the prompt. */
  taskLimit?: number;
  /** Context Assembly Engine sprint: max recent-decision memories injected into the prompt, after deduplication against `memories`. */
  decisionLimit?: number;
}
