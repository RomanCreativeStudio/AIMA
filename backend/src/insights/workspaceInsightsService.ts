import type { ActionLogger } from '../actionLog/logger';
import type { ApprovalEngine } from '../approval/approvalEngine';
import type { ApprovalStatus } from '../approval/types';
import type { Task } from '../tasks/types';
import type { TaskService } from '../tasks/taskService';
import type { WorkflowRun, WorkflowRunStatus } from '../workflows/types';
import { WORKFLOW_RUN_STATUSES } from '../workflows/types';
import type { WorkflowService } from '../workflows/workflowService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import { ACTIVE_WORKFLOW_RUN_STATUSES, type ApprovalMetrics, type TaskCompletionMetrics, type WorkflowMetrics, type WorkspaceInsights } from './types';

/**
 * Workspace Insights (Phase 2.5, item 4): aggregate counts only — activity,
 * workflow, approval, and task-completion metrics — cheap enough to
 * compute on every dashboard load. No row-level detail is returned here;
 * `BriefingService`/`TaskIntelligenceService` are where the actual items
 * live.
 */
export class WorkspaceInsightsService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly actionLogger: ActionLogger,
    private readonly workflowService: WorkflowService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly taskService: TaskService,
  ) {}

  async getInsights(workspaceId: string): Promise<WorkspaceInsights> {
    await this.workspaceService.getWorkspace(workspaceId);

    const [activityCounts, workflowRuns, approvals, tasks] = await Promise.all([
      this.actionLogger.countByOutcome(workspaceId),
      this.workflowService.listRuns(workspaceId),
      this.approvalEngine.list(workspaceId),
      this.taskService.listTasks(workspaceId),
    ]);

    return {
      workspaceId,
      activityMetrics: {
        totalActions: activityCounts.total,
        successfulActions: activityCounts.success,
        failedActions: activityCounts.failure,
      },
      workflowMetrics: summarizeWorkflowRuns(workflowRuns),
      approvalMetrics: summarizeApprovals(approvals.map((approval) => approval.status)),
      taskMetrics: summarizeTasks(tasks),
      generatedAt: new Date().toISOString(),
    };
  }
}

export function summarizeWorkflowRuns(runs: readonly WorkflowRun[]): WorkflowMetrics {
  const byStatus = Object.fromEntries(WORKFLOW_RUN_STATUSES.map((status) => [status, 0])) as Record<
    WorkflowRunStatus,
    number
  >;
  for (const run of runs) {
    byStatus[run.status] += 1;
  }

  const activeRuns = ACTIVE_WORKFLOW_RUN_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);

  return { totalRuns: runs.length, activeRuns, completedRuns: byStatus.completed, byStatus };
}

export function summarizeApprovals(statuses: readonly ApprovalStatus[]): ApprovalMetrics {
  const counts: ApprovalMetrics = { total: statuses.length, pending: 0, approved: 0, rejected: 0, expired: 0 };
  for (const status of statuses) {
    counts[status] += 1;
  }
  return counts;
}

export function summarizeTasks(tasks: readonly Task[]): TaskCompletionMetrics {
  const counts = { total: tasks.length, todo: 0, inProgress: 0, done: 0, cancelled: 0 };
  for (const task of tasks) {
    if (task.status === 'todo') counts.todo += 1;
    else if (task.status === 'in_progress') counts.inProgress += 1;
    else if (task.status === 'done') counts.done += 1;
    else if (task.status === 'cancelled') counts.cancelled += 1;
  }

  return { ...counts, completionRate: counts.total > 0 ? counts.done / counts.total : 0 };
}
