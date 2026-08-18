import type { TaskService } from '../tasks/taskService';
import { findDueSoon, findOverdue, groupRelatedTasks, isOpenTask, rankTasksByPriority } from './taskAnalysis';
import type { TaskIntelligence } from './types';

const DEFAULT_DUE_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export interface TaskIntelligenceOptions {
  dueSoonWindowMs?: number;
  /** Injectable for tests — everything here is deterministic given `now`, per docs/decisions/0013-productivity-intelligence.md. */
  now?: () => Date;
}

/**
 * Task Intelligence (Phase 2.5, item 2): suggested priorities, due-soon/
 * overdue detection, and related-task grouping over a workspace's open
 * tasks. Deliberately pure/deterministic — see `taskAnalysis.ts` — so this
 * service's only job is fetching the tasks and calling those pure
 * functions with `now`.
 */
export class TaskIntelligenceService {
  constructor(private readonly taskService: TaskService) {}

  async analyze(workspaceId: string, options: TaskIntelligenceOptions = {}): Promise<TaskIntelligence> {
    const now = (options.now ?? (() => new Date()))();
    const dueSoonWindowMs = options.dueSoonWindowMs ?? DEFAULT_DUE_SOON_WINDOW_MS;

    const tasks = await this.taskService.listTasks(workspaceId);
    const openTasks = tasks.filter(isOpenTask);

    return {
      workspaceId,
      suggestedPriorities: rankTasksByPriority(openTasks, now, dueSoonWindowMs),
      dueSoon: findDueSoon(openTasks, now, dueSoonWindowMs),
      overdue: findOverdue(openTasks, now),
      relatedGroups: groupRelatedTasks(openTasks),
      generatedAt: now.toISOString(),
    };
  }
}
