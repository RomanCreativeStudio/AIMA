import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import { TaskNotFoundError } from './errors';
import type { CreateTaskInput, Task, TaskPriority, TaskStatus, UpdateTaskInput } from './types';

/**
 * The Task Foundation (Phase 1.6): a minimal, workspace-scoped task model —
 * create/list/get/update/delete. Deliberately no assignment, subtasks,
 * labels, or advanced querying yet ("No advanced task UI" — the task asked
 * for the data foundation, not a full task-management feature). Mirrors
 * MemoryService/DocumentService's shape: workspace isolation enforced on
 * every method, WorkspaceNotFoundError/TaskNotFoundError reported
 * identically for a cross-workspace id as for a nonexistent one.
 */
export class TaskService {
  constructor(private readonly db: Queryable) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    await this.assertWorkspaceExists(input.workspaceId);

    const result = await this.db.query(
      `INSERT INTO tasks (workspace_id, title, description, priority, due_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, workspace_id, title, description, status, priority, due_date, created_at, updated_at`,
      [input.workspaceId, input.title, input.description ?? null, input.priority ?? 'medium', input.dueDate ?? null],
    );

    return mapTaskRow(result.rows[0]);
  }

  async listTasks(workspaceId: string, status?: TaskStatus): Promise<Task[]> {
    const conditions = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const result = await this.db.query(
      `SELECT id, workspace_id, title, description, status, priority, due_date, created_at, updated_at
       FROM tasks
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      params,
    );

    return result.rows.map(mapTaskRow);
  }

  async getTask(workspaceId: string, taskId: string): Promise<Task> {
    const result = await this.db.query(
      `SELECT id, workspace_id, title, description, status, priority, due_date, created_at, updated_at
       FROM tasks WHERE id = $1 AND workspace_id = $2`,
      [taskId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new TaskNotFoundError(taskId, workspaceId);
    }

    return mapTaskRow(result.rows[0]);
  }

  async updateTask(workspaceId: string, taskId: string, updates: UpdateTaskInput): Promise<Task> {
    await this.getTask(workspaceId, taskId); // existence + isolation check

    const fields: string[] = [];
    const params: unknown[] = [];

    const set = (column: string, value: unknown) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };

    if (updates.title !== undefined) set('title', updates.title);
    if (updates.description !== undefined) set('description', updates.description);
    if (updates.status !== undefined) set('status', updates.status);
    if (updates.priority !== undefined) set('priority', updates.priority);
    if (updates.dueDate !== undefined) set('due_date', updates.dueDate);

    if (fields.length === 0) {
      return this.getTask(workspaceId, taskId);
    }

    fields.push('updated_at = now()');
    params.push(taskId, workspaceId);

    const result = await this.db.query(
      `UPDATE tasks SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND workspace_id = $${params.length}
       RETURNING id, workspace_id, title, description, status, priority, due_date, created_at, updated_at`,
      params,
    );

    return mapTaskRow(result.rows[0]);
  }

  async deleteTask(workspaceId: string, taskId: string): Promise<void> {
    const result = await this.db.query('DELETE FROM tasks WHERE id = $1 AND workspace_id = $2', [
      taskId,
      workspaceId,
    ]);

    if (result.rowCount === 0) {
      throw new TaskNotFoundError(taskId, workspaceId);
    }
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface TaskRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date ? toIso(row.due_date) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
