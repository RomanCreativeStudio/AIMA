import type { ActionLogRecord } from '../actionLog/logger';
import type { PendingApproval } from '../approval/types';
import type { Message } from '../conversation/types';
import type { RankedMemoryResult } from '../memory/types';
import type { Task } from '../tasks/types';
import type { WorkflowRun, WorkflowRunStatus } from '../workflows/types';

/**
 * `workflow_runs.status` values that still need attention or are actively
 * progressing — everything not yet `completed`/`failed`/`cancelled`. Shared
 * by `BriefingService` (which workflows) and `WorkspaceInsightsService`
 * (how many).
 */
export const ACTIVE_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'pending',
  'running',
  'awaiting_approval',
  'paused',
];

/**
 * Phase 2.5, item 1: a single read-only snapshot of a workspace right now.
 * Deliberately not a persisted `workflow_runs` row like the Phase 2.4
 * `daily_workspace_briefing` workflow — this is a synchronous aggregate
 * query with no execution state, approval checkpoints, or history of its
 * own (docs/decisions/0013-productivity-intelligence.md).
 */
export interface DailyBriefing {
  workspaceId: string;
  workspaceName: string;
  pendingApprovalCount: number;
  pendingApprovals: PendingApproval[];
  activeWorkflowCount: number;
  activeWorkflows: WorkflowRun[];
  priorityTasks: Task[];
  recentActivity: ActionLogRecord[];
  generatedAt: string;
}

/** One deterministic grouping of open tasks that share a significant keyword in their title (Phase 2.5, item 2). */
export interface RelatedTaskGroup {
  keyword: string;
  taskIds: string[];
}

/**
 * Phase 2.5, item 2: pure, deterministic analysis over a workspace's open
 * tasks — no AI call, mirroring the "deterministic where possible" pattern
 * already used for chunking (`backend/src/knowledge/chunking.ts`) and
 * `WorkflowIntentMatcher`.
 */
export interface TaskIntelligence {
  workspaceId: string;
  suggestedPriorities: Task[];
  dueSoon: Task[];
  overdue: Task[];
  relatedGroups: RelatedTaskGroup[];
  generatedAt: string;
}

/**
 * Phase 2.5, item 3: AI-assisted analysis of one conversation's recent
 * turns. Unlike Task Intelligence, `summary`/`suggestedFollowUps` genuinely
 * need the AI provider — there's no deterministic substitute for "what
 * should the user ask next."
 */
export interface ConversationIntelligence {
  workspaceId: string;
  conversationId: string;
  summary: string;
  suggestedFollowUps: string[];
  recentContext: Message[];
  relatedMemories: RankedMemoryResult[];
  generatedAt: string;
}

export interface ActivityMetrics {
  totalActions: number;
  successfulActions: number;
  failedActions: number;
}

export interface WorkflowMetrics {
  totalRuns: number;
  activeRuns: number;
  completedRuns: number;
  byStatus: Record<WorkflowRunStatus, number>;
}

export interface ApprovalMetrics {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
}

export interface TaskCompletionMetrics {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  cancelled: number;
  /** `done / total`, or 0 for an empty workspace — never divides by zero. */
  completionRate: number;
}

/** Phase 2.5, item 4: aggregate counts only — no row-level detail, no AI call, safe to compute on every dashboard load. */
export interface WorkspaceInsights {
  workspaceId: string;
  activityMetrics: ActivityMetrics;
  workflowMetrics: WorkflowMetrics;
  approvalMetrics: ApprovalMetrics;
  taskMetrics: TaskCompletionMetrics;
  generatedAt: string;
}
