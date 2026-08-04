import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import type { PermissionEngine } from '../permissions/engine';
import type { TaskService } from '../tasks/taskService';
import { TaskNotFoundError } from '../tasks/errors';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../tasks/types';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface TasksRouterDependencies {
  taskService: TaskService;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

const CREATE_TASK_CAPABILITY = 'create_task';

/**
 * The Task Foundation API (Phase 1.6): create/list/get/update/delete, all
 * workspace-scoped. Only creation is routed through the PermissionEngine/
 * ActionLogger (reusing the 'create_task' capability registered in the
 * Foundation Sprint) — update/delete are plain scoped writes for now, a
 * deliberate scope decision for this foundation-only phase (see
 * docs/decisions/0006-assistant-core-orchestration.md).
 */
export function tasksRouter(deps: TasksRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/tasks', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { title, description, priority, dueDate, source, metadata } = req.body ?? {};

      if (typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      if (priority !== undefined && !isTaskPriority(priority)) {
        res.status(400).json({ error: `priority must be one of: ${TASK_PRIORITIES.join(', ')}` });
        return;
      }
      if (dueDate !== undefined && typeof dueDate !== 'string') {
        res.status(400).json({ error: 'dueDate must be a string if provided' });
        return;
      }
      if (source !== undefined && typeof source !== 'string') {
        res.status(400).json({ error: 'source must be a string if provided' });
        return;
      }
      if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
        res.status(400).json({ error: 'metadata must be an object if provided' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(CREATE_TASK_CAPABILITY);

      let task;
      try {
        task = await deps.taskService.createTask({
          workspaceId,
          title,
          description: typeof description === 'string' ? description : undefined,
          priority,
          dueDate,
          source,
          metadata,
        });
      } catch (error) {
        if (!(error instanceof WorkspaceNotFoundError)) {
          await deps.actionLogger.log({
            workspaceId,
            tier: deps.permissionEngine.resolveTier(CREATE_TASK_CAPABILITY),
            summary: 'Failed to create a task',
            payload: { error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(CREATE_TASK_CAPABILITY),
        summary: 'Created a task',
        payload: { taskId: task.id },
        outcome: 'success',
      });

      res.status(201).json({ task, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/tasks', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const status = isTaskStatus(req.query.status) ? req.query.status : undefined;
      const tasks = await deps.taskService.listTasks(workspaceId, status);
      res.json({ tasks });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/tasks/:taskId', async (req, res, next) => {
    try {
      const { workspaceId, taskId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(taskId)) {
        res.status(400).json({ error: 'workspaceId and taskId must be valid UUIDs' });
        return;
      }

      const task = await deps.taskService.getTask(workspaceId, taskId);
      res.json({ task });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.patch('/workspaces/:workspaceId/tasks/:taskId', async (req, res, next) => {
    try {
      const { workspaceId, taskId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(taskId)) {
        res.status(400).json({ error: 'workspaceId and taskId must be valid UUIDs' });
        return;
      }

      const { title, description, status, priority, dueDate } = req.body ?? {};

      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
        res.status(400).json({ error: 'title must be a non-empty string if provided' });
        return;
      }
      if (status !== undefined && !isTaskStatus(status)) {
        res.status(400).json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` });
        return;
      }
      if (priority !== undefined && !isTaskPriority(priority)) {
        res.status(400).json({ error: `priority must be one of: ${TASK_PRIORITIES.join(', ')}` });
        return;
      }

      const task = await deps.taskService.updateTask(workspaceId, taskId, {
        title,
        description,
        status,
        priority,
        dueDate,
      });

      res.json({ task });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.delete('/workspaces/:workspaceId/tasks/:taskId', async (req, res, next) => {
    try {
      const { workspaceId, taskId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(taskId)) {
        res.status(400).json({ error: 'workspaceId and taskId must be valid UUIDs' });
        return;
      }

      await deps.taskService.deleteTask(workspaceId, taskId);
      res.json({ deleted: true });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof TaskNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
