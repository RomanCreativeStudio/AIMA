import type { ActionLogRecord } from '../actionLog/logger';
import type { PendingApproval } from '../approval/types';
import type { Message } from '../conversation/types';
import type { WorkspaceIntegration } from '../integrations/types';
import type { MemoryRecord, RankedMemoryResult } from '../memory/types';
import type { Suggestion } from '../proactive/types';
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
  /** Most recently created/updated memories (Phase 3.5, item 2) — a plain, non-search read via `MemoryService.listMemories`, not a similarity search (there's no query to rank against in a briefing). */
  recentMemories: MemoryRecord[];
  /**
   * Calendar-related entries from `recentActivity` (Phase 3.5, item 2) — deliberately derived from the action
   * log, never a live call to the Calendar connector's `listEvents`: reading a connected calendar is Tier 3 and
   * tier-locked (`read_calendar`, permanently requires approval), and a plain briefing GET must never bypass
   * that. This only ever reflects calendar writes that already went through approval
   * (`create_calendar_event`/`update_calendar_event`/`delete_calendar_event`).
   */
  calendarHighlights: ActionLogRecord[];
  /** Top advisory suggestions from the Proactive Intelligence Engine (Phase 3.5, item 1) — informational only; never itself creates, executes, or sends anything. */
  suggestedNextActions: Suggestion[];
  /** Alpha Daily Briefing sprint: a deterministic, time-of-day greeting — see `buildGreeting` in `briefingService.ts`. No AI call, same "deterministic where possible" posture as `taskAnalysis.ts`. */
  greeting: string;
  /** Alpha Daily Briefing sprint: open tasks past their due date — reuses `taskAnalysis.ts#findOverdue` (the same pure function `TaskIntelligenceService` already uses), not a second overdue calculation. A subset of tasks that may also appear in `priorityTasks`. */
  overdueTasks: Task[];
  /** Alpha Daily Briefing sprint: connected integrations whose `status` is `error`, or `disconnected` while still `enabled`, or whose `tokenExpiresAt` has already passed — see `needsAttention` in `briefingService.ts`. Empty when `IntegrationService` isn't supplied. */
  integrationsNeedingAttention: WorkspaceIntegration[];
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

/**
 * Beta Tester Infrastructure sprint: engagement signals that `WorkspaceInsights` doesn't already cover —
 * "actions approved/executed" are already `WorkspaceInsights.approvalMetrics`/`activityMetrics`, so they're
 * deliberately not repeated here. `lastActiveAt` is the owning user's most recent `auth_sessions.last_seen_at`
 * across all their devices, or `null` for an account with no session yet recorded (a seeded/test account).
 */
export interface UsageMetrics {
  workspaceId: string;
  conversationsCreated: number;
  messagesSent: number;
  memoriesCreated: number;
  integrationsConnected: number;
  lastActiveAt: string | null;
  generatedAt: string;
}
