import { Router, type Response } from 'express';
import { ExecutionApprovalNotYetGrantedError, ExecutionNotFoundError, ExecutorNotFoundError } from '../execution/errors';
import type { ExecutionService } from '../execution/executionService';
import { IntegrationNotFoundError } from '../integrations/errors';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface ExecutionsRouterDependencies {
  executionService: ExecutionService;
}

/**
 * The Action Execution Foundation's API (Phase 2.6, item 6). `preview` is a
 * pure read with no persistence; `POST /executions` creates a request and
 * evaluates approval without ever contacting a provider; `POST .../execute`
 * is the one dedicated call that can actually run something, and is safe
 * to retry — it's a no-op once the record reaches a terminal status. No
 * route here is ever invoked automatically by chat (docs/decisions/
 * 0014-action-execution-foundation.md).
 */
export function executionsRouter(deps: ExecutionsRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/executions/preview', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { actionType, payload } = req.body ?? {};
      if (typeof actionType !== 'string' || actionType.trim().length === 0) {
        res.status(400).json({ error: 'actionType is required' });
        return;
      }

      const preview = await deps.executionService.preview(workspaceId, actionType, payload ?? {});
      res.json({ preview });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/executions', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { actionType, payload } = req.body ?? {};
      if (typeof actionType !== 'string' || actionType.trim().length === 0) {
        res.status(400).json({ error: 'actionType is required' });
        return;
      }

      const execution = await deps.executionService.createExecutionRequest({
        workspaceId,
        actionType,
        payload: payload ?? {},
      });
      res.status(201).json({ execution });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/executions', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const executions = await deps.executionService.listHistory(workspaceId);
      res.json({ executions });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/executions/:executionId', async (req, res, next) => {
    try {
      const { workspaceId, executionId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(executionId)) {
        res.status(400).json({ error: 'workspaceId and executionId must be valid UUIDs' });
        return;
      }

      const execution = await deps.executionService.getExecution(workspaceId, executionId);
      res.json({ execution });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/executions/:executionId/execute', async (req, res, next) => {
    try {
      const { workspaceId, executionId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(executionId)) {
        res.status(400).json({ error: 'workspaceId and executionId must be valid UUIDs' });
        return;
      }

      const execution = await deps.executionService.execute(workspaceId, executionId);
      res.json({ execution });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (
    error instanceof WorkspaceNotFoundError ||
    error instanceof ExecutionNotFoundError ||
    error instanceof IntegrationNotFoundError
  ) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof ExecutorNotFoundError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ExecutionApprovalNotYetGrantedError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
