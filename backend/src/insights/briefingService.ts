import type { ActionLogger, ActionLogRecord } from '../actionLog/logger';
import type { ApprovalEngine } from '../approval/approvalEngine';
import type { IntegrationService } from '../integrations/integrationService';
import type { WorkspaceIntegration } from '../integrations/types';
import type { MemoryService } from '../memory/memoryService';
import type { MemoryRecord } from '../memory/types';
import type { ProactiveIntelligenceService } from '../proactive/proactiveIntelligenceService';
import type { Task } from '../tasks/types';
import type { TaskService } from '../tasks/taskService';
import type { WorkflowService } from '../workflows/workflowService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import { findOverdue, isOpenTask, rankTasksByPriority } from './taskAnalysis';
import { ACTIVE_WORKFLOW_RUN_STATUSES, type DailyBriefing } from './types';

const DEFAULT_PRIORITY_TASK_LIMIT = 5;
const DEFAULT_RECENT_ACTIVITY_LIMIT = 10;
const DEFAULT_DUE_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days, matching TaskIntelligenceService's default
const DEFAULT_RECENT_MEMORY_LIMIT = 5;
/** Personal Workspace Memory sprint: how many memories `getDailyBriefing` fetches in its single `listMemories` call — wide enough that `openCommitments` (derived from the same result set, see `isOpenCommitment`) isn't starved by `recentMemories`' tighter display limit. */
const DEFAULT_MEMORY_FETCH_LIMIT = 20;
const DEFAULT_SUGGESTED_ACTION_LIMIT = 3;
/** Conversation → Action sprint: display cap for `acceptedTasks`/`unresolvedFollowUps`, mirroring `DEFAULT_RECENT_MEMORY_LIMIT`'s role for memory-derived fields. Applied after filtering the full `tasks` list, so a workspace with many accepted tasks still surfaces its most recent unresolved follow-ups rather than whichever happened to survive an earlier slice. */
const DEFAULT_ACCEPTED_TASK_LIMIT = 10;
/** Real writes that already went through Tier 3 approval — see `DailyBriefing.calendarHighlights`'s doc comment. */
const CALENDAR_ACTION_TYPES = new Set(['create_calendar_event', 'update_calendar_event', 'delete_calendar_event']);
/** Auto-extracted categories (see `ConversationService.AUTO_SAVE_CATEGORIES`) that represent an outcome still open — `completed_task` is deliberately excluded, since a completed task is finished, not "unfinished." */
const OPEN_COMMITMENT_CATEGORIES = new Set(['reminder', 'decision', 'project_update']);
/** Conversation → Action sprint: how a task accepted from a Chat suggestion records where it came from — see `backend/src/tasks/types.ts#Task.source`. */
const CONVERSATION_SUGGESTION_SOURCE = 'conversation_suggestion';

/**
 * The Daily Briefing (Phase 2.5, item 1): a synchronous, read-only
 * aggregate over a workspace's current state — workspace summary, pending
 * approvals, active workflow runs, priority tasks, and recent activity.
 * Composes existing services rather than adding new persistence
 * (docs/decisions/0013-productivity-intelligence.md); it never writes
 * anything, unlike the Phase 2.4 `daily_workspace_briefing` *workflow*,
 * which creates a real `workflow_runs` row and can be paused/resumed —
 * that one is a stateful action a user starts, this one is a plain report
 * the client can re-fetch as often as it likes with no side effects.
 */
export class BriefingService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly taskService: TaskService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly workflowService: WorkflowService,
    private readonly actionLogger: ActionLogger,
    /** Additive (Phase 3.5) — optional so every pre-3.5 call site (mostly test files that only need `BriefingService` to exist for router wiring, not its full output) keeps compiling unchanged. Omitting it just means `recentMemories`/`suggestedNextActions` come back empty. */
    private readonly memoryService?: MemoryService,
    private readonly proactiveIntelligenceService?: ProactiveIntelligenceService,
    /** Alpha Daily Briefing sprint: same optional posture as `memoryService`/`proactiveIntelligenceService` — omitting it just means `integrationsNeedingAttention` comes back empty. */
    private readonly integrationService?: IntegrationService,
  ) {}

  async getDailyBriefing(workspaceId: string): Promise<DailyBriefing> {
    const workspace = await this.workspaceService.getWorkspace(workspaceId);

    const [tasks, pendingApprovals, workflowRuns, recentActivity, memories, suggestions, integrations] =
      await Promise.all([
        this.taskService.listTasks(workspaceId),
        this.approvalEngine.list(workspaceId, 'pending'),
        this.workflowService.listRuns(workspaceId),
        this.actionLogger.list(workspaceId, DEFAULT_RECENT_ACTIVITY_LIMIT),
        this.memoryService?.listMemories({ workspaceId, limit: DEFAULT_MEMORY_FETCH_LIMIT }) ?? Promise.resolve([]),
        this.proactiveIntelligenceService?.getSuggestions(workspaceId) ?? Promise.resolve([]),
        this.integrationService?.listForWorkspace(workspaceId) ?? Promise.resolve([]),
      ]);

    const activeWorkflows = workflowRuns.filter((run) => ACTIVE_WORKFLOW_RUN_STATUSES.includes(run.status));
    const openTasks = tasks.filter(isOpenTask);
    const now = new Date();
    const priorityTasks = rankTasksByPriority(openTasks, now, DEFAULT_DUE_SOON_WINDOW_MS).slice(
      0,
      DEFAULT_PRIORITY_TASK_LIMIT,
    );
    const acceptedTasksAll = tasks.filter((task) => task.source === CONVERSATION_SUGGESTION_SOURCE);

    return {
      workspaceId,
      workspaceName: workspace.name,
      pendingApprovalCount: pendingApprovals.length,
      pendingApprovals,
      activeWorkflowCount: activeWorkflows.length,
      activeWorkflows,
      priorityTasks,
      recentActivity,
      recentMemories: memories.slice(0, DEFAULT_RECENT_MEMORY_LIMIT),
      calendarHighlights: recentActivity.filter((entry) => isCalendarActivity(entry)),
      suggestedNextActions: suggestions.slice(0, DEFAULT_SUGGESTED_ACTION_LIMIT),
      greeting: buildGreeting(workspace.name, now),
      overdueTasks: findOverdue(openTasks, now),
      integrationsNeedingAttention: integrations.filter(needsAttention),
      openCommitments: memories.filter(isOpenCommitment),
      acceptedTasks: acceptedTasksAll.slice(0, DEFAULT_ACCEPTED_TASK_LIMIT),
      unresolvedFollowUps: acceptedTasksAll.filter(isUnresolvedFollowUp).slice(0, DEFAULT_ACCEPTED_TASK_LIMIT),
      recentDecisions: memories.filter(isRecentDecision).slice(0, DEFAULT_RECENT_MEMORY_LIMIT),
      generatedAt: now.toISOString(),
    };
  }
}

function isCalendarActivity(entry: ActionLogRecord): boolean {
  return entry.actionType !== null && CALENDAR_ACTION_TYPES.has(entry.actionType);
}

/** Deterministic, time-of-day greeting — no AI call, mirroring `taskAnalysis.ts`'s "deterministic where possible" posture. Boundaries are local-to-the-process wall-clock hours: before noon, before 6pm, otherwise evening. Exported (like `taskAnalysis.ts`'s helpers) so it's directly unit-testable rather than only through a full `getDailyBriefing` call. */
export function buildGreeting(workspaceName: string, now: Date): string {
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}! Here's what's happening in ${workspaceName}.`;
}

/** An integration a founder should look at: it's actively erroring, it's enabled but disconnected, or its stored token has already expired. Never a live provider call — reads only what `IntegrationService.listForWorkspace` already returns. Exported for direct unit testing (see `buildGreeting`'s doc comment). */
export function needsAttention(integration: WorkspaceIntegration): boolean {
  if (integration.status === 'error') return true;
  if (integration.enabled && integration.status === 'disconnected') return true;
  if (integration.tokenExpiresAt && new Date(integration.tokenExpiresAt).getTime() < Date.now()) return true;
  return false;
}

/** A `ConversationService`-auto-saved memory whose outcome is still unfinished — see `OPEN_COMMITMENT_CATEGORIES`. Manually-created memories (no `metadata.category`, or `source` other than `'auto_extracted'`) never qualify: this is specifically "commitments AIMA noticed," not every memory. Exported for direct unit testing (see `buildGreeting`'s doc comment). */
export function isOpenCommitment(memory: MemoryRecord): boolean {
  if (memory.source !== 'auto_extracted') return false;
  const category = memory.metadata?.category;
  return typeof category === 'string' && OPEN_COMMITMENT_CATEGORIES.has(category);
}

/** Conversation → Action sprint: an accepted task (already filtered to `source: 'conversation_suggestion'`) that's still open and whose suggestion category was `follow_up` — the thing that still needs closing the loop. Exported for direct unit testing. */
export function isUnresolvedFollowUp(task: Task): boolean {
  return isOpenTask(task) && task.metadata?.category === 'follow_up';
}

/** Conversation → Action sprint: an auto-extracted memory whose category is `decision` — the same auto-save pipeline `isOpenCommitment` reads from, filtered to just decisions rather than every open-commitment category. Exported for direct unit testing. */
export function isRecentDecision(memory: MemoryRecord): boolean {
  return memory.source === 'auto_extracted' && memory.metadata?.category === 'decision';
}
