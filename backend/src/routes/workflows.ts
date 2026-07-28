import { Router, type Response } from 'express';
import { WorkspaceNotFoundError } from '../types/errors';
import { InvalidWorkflowStateError, WorkflowApprovalNotYetGrantedError, WorkflowRunNotFoundError } from '../workflows/errors';
import type { WorkflowRegistry } from '../workflows/registry';
import { isWorkflowKey } from '../workflows/types';
import type { WorkflowService } from '../workflows/workflowService';
import { isUuid } from '../util/uuid';

export interface WorkflowsRouterDependencies {
  workflowService: WorkflowService;
  workflowRegistry: WorkflowRegistry;
}

/**
 * The Workflow Engine's API (Phase 2.4): definitions plus create/execute/
 * pause/resume/cancel/history over a workspace's runs. `execute` advances
 * exactly one step per call — there is deliberately no "run to completion"
 * route, since every external step must pause for approval, and nothing
 * here is allowed to loop past that on its own.
 */
export function workflowsRouter(deps: WorkflowsRouterDependencies): Router {
  const router = Router();

  router.get('/workflows', (_req, res) => {
    res.json({ workflows: deps.workflowRegistry.list() });
  });

  router.get('/workspaces/:workspaceId/workflow-runs', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const runs = await deps.workflowService.listRuns(workspaceId);
      res.json({ runs });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/workflow-runs', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { workflowKey, input } = req.body ?? {};
      if (typeof workflowKey !== 'string' || !isWorkflowKey(workflowKey)) {
        res.status(400).json({ error: 'workflowKey must be one of the registered workflows' });
        return;
      }
      if (!isStringRecord(input ?? {})) {
        res.status(400).json({ error: 'input must be an object of string fields' });
        return;
      }

      const run = await deps.workflowService.createRun({ workspaceId, workflowKey, input: input ?? {} });
      res.status(201).json({ run });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/workflow-runs/:runId', async (req, res, next) => {
    try {
      const { workspaceId, runId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(runId)) {
        res.status(400).json({ error: 'workspaceId and runId must be valid UUIDs' });
        return;
      }

      const run = await deps.workflowService.getRun(workspaceId, runId);
      res.json({ run });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/workflow-runs/:runId/execute', async (req, res, next) => {
    try {
      const { workspaceId, runId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(runId)) {
        res.status(400).json({ error: 'workspaceId and runId must be valid UUIDs' });
        return;
      }

      const run = await deps.workflowService.executeNextStep(workspaceId, runId);
      res.json({ run });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/workflow-runs/:runId/pause', async (req, res, next) => {
    try {
      const { workspaceId, runId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(runId)) {
        res.status(400).json({ error: 'workspaceId and runId must be valid UUIDs' });
        return;
      }

      const run = await deps.workflowService.pause(workspaceId, runId);
      res.json({ run });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/workflow-runs/:runId/resume', async (req, res, next) => {
    try {
      const { workspaceId, runId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(runId)) {
        res.status(400).json({ error: 'workspaceId and runId must be valid UUIDs' });
        return;
      }

      const run = await deps.workflowService.resume(workspaceId, runId);
      res.json({ run });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/workflow-runs/:runId/cancel', async (req, res, next) => {
    try {
      const { workspaceId, runId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(runId)) {
        res.status(400).json({ error: 'workspaceId and runId must be valid UUIDs' });
        return;
      }

      const run = await deps.workflowService.cancel(workspaceId, runId);
      res.json({ run });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((field) => typeof field === 'string');
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof WorkflowRunNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidWorkflowStateError || error instanceof WorkflowApprovalNotYetGrantedError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
