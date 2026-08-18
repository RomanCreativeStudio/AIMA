export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The initial task model (Phase 1.6, Task Foundation) — deliberately minimal, no assignment/subtasks/labels yet. */
export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  /** Conversation → Action sprint: `'conversation_suggestion'` when this task was accepted from a Chat suggestion, `null` for a task typed in by hand. Mirrors `MemoryRecord.source`. */
  source: string | null;
  /** Conversation → Action sprint: for a `source: 'conversation_suggestion'` task, carries `{ category: 'todo' | 'follow_up' | 'meeting' }` — how `BriefingService` picks out `unresolvedFollowUps`. Empty object for a hand-created task. */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  /** Executive Assistant Loop sprint: replaces `metadata` wholesale when provided (mirrors `MemoryService.updateMemory`'s "replace, don't merge" semantics) — how Accepting a blocked/postponed/delegated suggestion tags `metadata.category` without touching `status`/`dueDate`. */
  metadata?: Record<string, unknown>;
}
