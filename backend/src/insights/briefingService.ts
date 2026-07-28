import type { ActionLogger, ActionLogRecord } from '../actionLog/logger';
import type { ApprovalEngine } from '../approval/approvalEngine';
import type { MemoryService } from '../memory/memoryService';
import type { ProactiveIntelligenceService } from '../proactive/proactiveIntelligenceService';
import type { TaskService } from '../tasks/taskService';
import type { WorkflowService } from '../workflows/workflowService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import { isOpenTask, rankTasksByPriority } from './taskAnalysis';
import { ACTIVE_WORKFLOW_RUN_STATUSES, type DailyBriefing } from './types';

const DEFAULT_PRIORITY_TASK_LIMIT = 5;
const DEFAULT_RECENT_ACTIVITY_LIMIT = 10;
const DEFAULT_DUE_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days, matching TaskIntelligenceService's default
const DEFAULT_RECENT_MEMORY_LIMIT = 5;
const DEFAULT_SUGGESTED_ACTION_LIMIT = 3;
/** Real writes that already went through Tier 3 approval — see `DailyBriefing.calendarHighlights`'s doc comment. */
const CALENDAR_ACTION_TYPES = new Set(['create_calendar_event', 'update_calendar_event', 'delete_calendar_event']);

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
  ) {}

  async getDailyBriefing(workspaceId: string): Promise<DailyBriefing> {
    const workspace = await this.workspaceService.getWorkspace(workspaceId);

    const [tasks, pendingApprovals, workflowRuns, recentActivity, recentMemories, suggestions] = await Promise.all([
      this.taskService.listTasks(workspaceId),
      this.approvalEngine.list(workspaceId, 'pending'),
      this.workflowService.listRuns(workspaceId),
      this.actionLogger.list(workspaceId, DEFAULT_RECENT_ACTIVITY_LIMIT),
      this.memoryService?.listMemories({ workspaceId, limit: DEFAULT_RECENT_MEMORY_LIMIT }) ?? Promise.resolve([]),
      this.proactiveIntelligenceService?.getSuggestions(workspaceId) ?? Promise.resolve([]),
    ]);

    const activeWorkflows = workflowRuns.filter((run) => ACTIVE_WORKFLOW_RUN_STATUSES.includes(run.status));
    const priorityTasks = rankTasksByPriority(tasks.filter(isOpenTask), new Date(), DEFAULT_DUE_SOON_WINDOW_MS).slice(
      0,
      DEFAULT_PRIORITY_TASK_LIMIT,
    );

    return {
      workspaceId,
      workspaceName: workspace.name,
      pendingApprovalCount: pendingApprovals.length,
      pendingApprovals,
      activeWorkflowCount: activeWorkflows.length,
      activeWorkflows,
      priorityTasks,
      recentActivity,
      recentMemories,
      calendarHighlights: recentActivity.filter((entry) => isCalendarActivity(entry)),
      suggestedNextActions: suggestions.slice(0, DEFAULT_SUGGESTED_ACTION_LIMIT),
      generatedAt: new Date().toISOString(),
    };
  }
}

function isCalendarActivity(entry: ActionLogRecord): boolean {
  return entry.actionType !== null && CALENDAR_ACTION_TYPES.has(entry.actionType);
}
