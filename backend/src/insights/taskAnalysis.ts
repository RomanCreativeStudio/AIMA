import type { Task } from '../tasks/types';
import type { RelatedTaskGroup } from './types';

const OPEN_STATUSES: ReadonlySet<Task['status']> = new Set(['todo', 'in_progress']);

/** A task still worth surfacing — not `done` or `cancelled`. */
export function isOpenTask(task: Task): boolean {
  return OPEN_STATUSES.has(task.status);
}

const PRIORITY_WEIGHT: Record<Task['priority'], number> = { high: 30, medium: 20, low: 10 };

/**
 * Deterministic priority score for one open task, evaluated against `now`.
 * Overdue tasks always outrank everything else; due-soon tasks outrank a
 * task with no due date at the same declared priority; ties break on due
 * date (soonest first), then `createdAt` (oldest first — first in, first
 * out for anything left equally unranked). No AI call — Task Intelligence
 * is deliberately deterministic, mirroring `chunking.ts`/
 * `WorkflowIntentMatcher`'s existing "pure function, no model" precedent.
 */
export function scoreTaskPriority(task: Task, now: Date, dueSoonWindowMs: number): number {
  let score = PRIORITY_WEIGHT[task.priority];

  if (task.dueDate) {
    const msUntilDue = new Date(task.dueDate).getTime() - now.getTime();
    if (msUntilDue < 0) {
      score += 1000 + Math.min(-msUntilDue / (60 * 60 * 1000), 1000); // more overdue -> (slightly) higher
    } else if (msUntilDue <= dueSoonWindowMs) {
      score += 500 - msUntilDue / (60 * 60 * 1000);
    }
  }

  return score;
}

export function rankTasksByPriority(tasks: readonly Task[], now: Date, dueSoonWindowMs: number): Task[] {
  return [...tasks].sort((a, b) => {
    const scoreDiff = scoreTaskPriority(b, now, dueSoonWindowMs) - scoreTaskPriority(a, now, dueSoonWindowMs);
    if (scoreDiff !== 0) return scoreDiff;

    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function findOverdue(tasks: readonly Task[], now: Date): Task[] {
  return tasks.filter((task) => task.dueDate !== null && new Date(task.dueDate).getTime() < now.getTime());
}

/** Due within `windowMs` from `now`, excluding anything already overdue (that's `findOverdue`'s job). */
export function findDueSoon(tasks: readonly Task[], now: Date, windowMs: number): Task[] {
  return tasks.filter((task) => {
    if (!task.dueDate) return false;
    const msUntilDue = new Date(task.dueDate).getTime() - now.getTime();
    return msUntilDue >= 0 && msUntilDue <= windowMs;
  });
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'about', 'into', 'over', 'after', 'before',
  'follow', 'up', 'review', 'update', 'send', 'draft', 'task', 'todo',
]);

/** Lowercased, deduplicated significant words (length > 3, not a stopword) from a task title — the unit `groupRelatedTasks` clusters on. */
export function extractKeywords(title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
  return Array.from(new Set(words));
}

/**
 * Executive Assistant Loop sprint: which open task a free-text conversation
 * candidate (completed_task/blocked/postponed/delegated) most likely refers
 * to — reuses `extractKeywords` (the same keyword-overlap heuristic
 * `groupRelatedTasks` already uses for task-to-task matching), not a new
 * fuzzy/AI matcher. Returns the open task whose title shares the most
 * keywords with `content`, or `null` if no open task shares a single
 * keyword. Ties break on `createdAt` (most recently created wins) — the
 * newest matching task is more likely to be the one just discussed.
 */
export function matchOpenTask(content: string, openTasks: readonly Task[]): Task | null {
  const contentKeywords = new Set(extractKeywords(content));
  if (contentKeywords.size === 0) {
    return null;
  }

  let best: Task | null = null;
  let bestOverlap = 0;

  for (const task of openTasks) {
    const overlap = extractKeywords(task.title).filter((keyword) => contentKeywords.has(keyword)).length;
    if (overlap === 0) {
      continue;
    }
    const isBetter =
      overlap > bestOverlap ||
      (overlap === bestOverlap && best !== null && new Date(task.createdAt).getTime() > new Date(best.createdAt).getTime());
    if (isBetter) {
      best = task;
      bestOverlap = overlap;
    }
  }

  return best;
}

/**
 * Tasks marked `done` within the last `windowMs` from `now` — the "completed
 * yesterday" rolling 24h window `BriefingService` uses, mirroring
 * `findOverdue`'s pure-filter style. Uses `updatedAt` since tasks have no
 * separate `completedAt` column — `TaskService.updateTask` already bumps
 * `updated_at` on every status change, including the transition to `done`.
 */
export function findCompletedRecently(tasks: readonly Task[], now: Date, windowMs: number): Task[] {
  return tasks.filter((task) => {
    if (task.status !== 'done') {
      return false;
    }
    const msSinceUpdate = now.getTime() - new Date(task.updatedAt).getTime();
    return msSinceUpdate >= 0 && msSinceUpdate <= windowMs;
  });
}

/**
 * Deterministic "related tasks" grouping (Phase 2.5, item 2): two open
 * tasks are related if their titles share a significant keyword. No
 * semantic/embedding similarity — this reuses only the title text already
 * on hand, the same "don't reach for AI when a plain heuristic is
 * testable and good enough" choice `chunking.ts` made for document
 * splitting. Only keywords shared by 2+ tasks are returned; groups are
 * sorted by size (largest first), then alphabetically for stable output.
 */
export function groupRelatedTasks(tasks: readonly Task[]): RelatedTaskGroup[] {
  const taskIdsByKeyword = new Map<string, string[]>();

  for (const task of tasks) {
    for (const keyword of extractKeywords(task.title)) {
      const existing = taskIdsByKeyword.get(keyword);
      if (existing) {
        existing.push(task.id);
      } else {
        taskIdsByKeyword.set(keyword, [task.id]);
      }
    }
  }

  const groups: RelatedTaskGroup[] = [];
  for (const [keyword, taskIds] of taskIdsByKeyword) {
    if (taskIds.length >= 2) {
      groups.push({ keyword, taskIds });
    }
  }

  return groups.sort((a, b) => b.taskIds.length - a.taskIds.length || a.keyword.localeCompare(b.keyword));
}
