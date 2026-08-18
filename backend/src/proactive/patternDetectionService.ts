import { computeRecurrenceConfidence, detectRecurringPatterns, detectTrend, type OccurrenceEvent } from '@aima/ai-engine';
import type { ActionLogger } from '../actionLog/logger';
import type { ActionLogRecord } from '../actionLog/logger';
import type { ApprovalEngine } from '../approval/approvalEngine';
import type { PendingApproval } from '../approval/types';
import { findDecisionsWithoutFollowUp, findStaleBlockedTasks, isRecentDecision } from '../insights/briefingService';
import { findOverdueByAtLeast, groupRelatedTasks, isOpenTask } from '../insights/taskAnalysis';
import type { MemoryRecord } from '../memory/types';
import type { MemoryService } from '../memory/memoryService';
import type { Task } from '../tasks/types';
import type { TaskService } from '../tasks/taskService';
import type { WorkflowRun } from '../workflows/types';
import type { WorkflowService } from '../workflows/workflowService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type { Pattern } from './types';

const MIN_OCCURRENCES = 2;
const TREND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Enough history to compute a two-window trend without an unbounded query. */
const ACTIVITY_SAMPLE_LIMIT = 200;
const MEMORY_SAMPLE_LIMIT = 200;
/** Proactive Nudges sprint: default "overdue" grace period — 0 preserves `detectMissedDeadlines`'s pre-existing behavior (every overdue task counts) unless a caller opts into a longer threshold. */
const DEFAULT_OVERDUE_GRACE_DAYS = 0;

/**
 * Deterministic pattern detection over a workspace's existing data (Phase 3.5, item 3):
 * repeated tasks, frequently used workflows, recurring approvals, missed deadlines, and
 * activity/memory-usage trends. No AI call, no ML training, no persistence of its own —
 * every method is a plain read composed from services that already exist, mirroring
 * `BriefingService`/`WorkspaceInsightsService`'s "aggregate existing data, add no new
 * tables" precedent (docs/decisions/0013-productivity-intelligence.md).
 */
export class PatternDetectionService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly taskService: TaskService,
    private readonly workflowService: WorkflowService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly actionLogger: ActionLogger,
    private readonly memoryService: MemoryService,
    /** Proactive Nudges sprint: how many days overdue a task must be before `detectMissedDeadlines` flags it — additive, optional, defaults to the pre-existing "any overdue task" behavior. */
    private readonly overdueGraceDays: number = DEFAULT_OVERDUE_GRACE_DAYS,
  ) {}

  async detect(workspaceId: string): Promise<Pattern[]> {
    await this.workspaceService.getWorkspace(workspaceId);

    const now = new Date();
    const [tasks, workflowRuns, approvals, recentActivity, memories] = await Promise.all([
      this.taskService.listTasks(workspaceId),
      this.workflowService.listRuns(workspaceId),
      this.approvalEngine.list(workspaceId),
      this.actionLogger.list(workspaceId, ACTIVITY_SAMPLE_LIMIT),
      this.memoryService.listMemories({ workspaceId, includeArchived: true, limit: MEMORY_SAMPLE_LIMIT }),
    ]);

    return [
      ...this.detectRepeatedTasks(workspaceId, tasks),
      ...this.detectFrequentWorkflows(workspaceId, workflowRuns),
      ...this.detectRecurringApprovals(workspaceId, approvals),
      ...this.detectMissedDeadlines(workspaceId, tasks, now),
      ...this.detectStaleBlockedTasks(workspaceId, tasks, now),
      ...this.detectDecisionsWithoutFollowUp(workspaceId, memories, tasks),
      this.detectActivityTrend(workspaceId, recentActivity, now),
      this.detectMemoryUsageTrend(workspaceId, memories, now),
    ];
  }

  /** Reuses `groupRelatedTasks` (Phase 2.5) — "two or more open tasks share a significant title keyword" already is this pattern. */
  private detectRepeatedTasks(workspaceId: string, tasks: readonly Task[]): Pattern[] {
    const now = new Date().toISOString();
    return groupRelatedTasks(tasks.filter(isOpenTask)).map((group) => ({
      workspaceId,
      type: 'repeated_task',
      description: `${group.taskIds.length} open tasks share the keyword "${group.keyword}".`,
      confidence: computeRecurrenceConfidence(group.taskIds.length, MIN_OCCURRENCES),
      occurrences: group.taskIds.length,
      detectedAt: now,
      metadata: { keyword: group.keyword, taskIds: group.taskIds },
    }));
  }

  private detectFrequentWorkflows(workspaceId: string, runs: readonly WorkflowRun[]): Pattern[] {
    const events: OccurrenceEvent[] = runs.map((run) => ({ key: run.workflowKey, occurredAt: run.createdAt }));
    return detectRecurringPatterns(events, MIN_OCCURRENCES).map((p) => ({
      workspaceId,
      type: 'frequent_workflow',
      description: `The "${p.key}" workflow has been run ${p.occurrences} times.`,
      confidence: p.confidence,
      occurrences: p.occurrences,
      detectedAt: new Date().toISOString(),
      metadata: { workflowKey: p.key, firstOccurredAt: p.firstOccurredAt, lastOccurredAt: p.lastOccurredAt },
    }));
  }

  private detectRecurringApprovals(workspaceId: string, approvals: readonly PendingApproval[]): Pattern[] {
    const events: OccurrenceEvent[] = approvals.map((approval) => ({
      key: approval.actionType,
      occurredAt: approval.createdAt,
    }));
    return detectRecurringPatterns(events, MIN_OCCURRENCES).map((p) => ({
      workspaceId,
      type: 'recurring_approval',
      description: `"${p.key}" has required approval ${p.occurrences} times.`,
      confidence: p.confidence,
      occurrences: p.occurrences,
      detectedAt: new Date().toISOString(),
      metadata: { actionType: p.key, firstOccurredAt: p.firstOccurredAt, lastOccurredAt: p.lastOccurredAt },
    }));
  }

  private detectMissedDeadlines(workspaceId: string, tasks: readonly Task[], now: Date): Pattern[] {
    const overdue = findOverdueByAtLeast(tasks.filter(isOpenTask), now, this.overdueGraceDays);
    if (overdue.length === 0) {
      return [];
    }
    return [
      {
        workspaceId,
        type: 'missed_deadline',
        description: `${overdue.length} open task(s) are past their due date.`,
        confidence: computeRecurrenceConfidence(overdue.length, 1),
        occurrences: overdue.length,
        detectedAt: now.toISOString(),
        metadata: { taskIds: overdue.map((task) => task.id) },
      },
    ];
  }

  /** Proactive Nudges sprint: reuses `briefingService.ts#findStaleBlockedTasks` — no duplicate staleness logic. */
  private detectStaleBlockedTasks(workspaceId: string, tasks: readonly Task[], now: Date): Pattern[] {
    const stale = findStaleBlockedTasks(tasks, now);
    if (stale.length === 0) {
      return [];
    }
    return [
      {
        workspaceId,
        type: 'blocked_task_stale',
        description: `${stale.length} blocked task(s) have had no update in 3+ days.`,
        confidence: computeRecurrenceConfidence(stale.length, 1),
        occurrences: stale.length,
        detectedAt: now.toISOString(),
        metadata: { taskIds: stale.map((task) => task.id) },
      },
    ];
  }

  /** Proactive Nudges sprint: reuses `briefingService.ts#isRecentDecision`/`findDecisionsWithoutFollowUp` — no duplicate decision detection or matching logic. */
  private detectDecisionsWithoutFollowUp(workspaceId: string, memories: readonly MemoryRecord[], tasks: readonly Task[]): Pattern[] {
    const decisions = memories.filter(isRecentDecision);
    const withoutFollowUp = findDecisionsWithoutFollowUp(decisions, tasks);
    if (withoutFollowUp.length === 0) {
      return [];
    }
    return [
      {
        workspaceId,
        type: 'decision_without_followup',
        description: `${withoutFollowUp.length} recent decision(s) have no follow-up task yet.`,
        confidence: computeRecurrenceConfidence(withoutFollowUp.length, 1),
        occurrences: withoutFollowUp.length,
        detectedAt: new Date().toISOString(),
        metadata: { memoryIds: withoutFollowUp.map((memory) => memory.id) },
      },
    ];
  }

  private detectActivityTrend(workspaceId: string, recentActivity: readonly ActionLogRecord[], now: Date): Pattern {
    const recentCount = countInWindow(recentActivity, now, 0);
    const priorCount = countInWindow(recentActivity, now, 1);
    const trend = detectTrend(recentCount, priorCount);

    return {
      workspaceId,
      type: 'activity_trend',
      description: `Workspace activity is ${trend.direction} (last 7 days: ${recentCount}, prior 7 days: ${priorCount}).`,
      confidence: trend.confidence,
      occurrences: recentCount,
      detectedAt: now.toISOString(),
      metadata: { direction: trend.direction, changeRatio: trend.changeRatio, recentCount, priorCount },
    };
  }

  private detectMemoryUsageTrend(workspaceId: string, memories: readonly MemoryRecord[], now: Date): Pattern {
    const recentCount = countInWindow(memories, now, 0);
    const priorCount = countInWindow(memories, now, 1);
    const trend = detectTrend(recentCount, priorCount);

    return {
      workspaceId,
      type: 'memory_usage_trend',
      description: `Memory creation is ${trend.direction} (last 7 days: ${recentCount}, prior 7 days: ${priorCount}).`,
      confidence: trend.confidence,
      occurrences: recentCount,
      detectedAt: now.toISOString(),
      metadata: { direction: trend.direction, changeRatio: trend.changeRatio, recentCount, priorCount },
    };
  }
}

/** Counts records created in the Nth most recent 7-day window (`windowsAgo = 0` is "the last 7 days", `1` is "the 7 days before that"). */
function countInWindow(records: readonly { createdAt: string }[], now: Date, windowsAgo: number): number {
  const windowEnd = now.getTime() - windowsAgo * TREND_WINDOW_MS;
  const windowStart = windowEnd - TREND_WINDOW_MS;
  return records.filter((record) => {
    const createdAt = new Date(record.createdAt).getTime();
    return createdAt > windowStart && createdAt <= windowEnd;
  }).length;
}
