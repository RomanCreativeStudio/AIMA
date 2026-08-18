import { Router, type Response } from 'express';
import type { ApprovalEngine } from '../approval/approvalEngine';
import { PendingApprovalAlreadyResolvedError, PendingApprovalExpiredError, PendingApprovalNotFoundError } from '../approval/errors';
import type { ApprovalStatus } from '../approval/types';
import { isUuid } from '../util/uuid';

export interface ApprovalsRouterDependencies {
  approvalEngine: ApprovalEngine;
}

const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired'];

/**
 * The Approval System's API (Phase 1.7, docs/decisions/0007-intent-and-
 * approval-workflows.md): list/get/approve/reject over `pending_approvals`.
 * There is deliberately no public "create an approval for any actionType"
 * route — creation only ever happens as a side effect of attempting a Tier
 * 3 action through its own capability-gated code path (currently
 * `AimaCoreService`, via `ApprovalEngine.evaluate`), never from a raw
 * client-supplied actionType, so the approval-requiring gate can't be
 * bypassed or spoofed from here.
 */
export function approvalsRouter(deps: ApprovalsRouterDependencies): Router {
  const router = Router();

  router.get('/workspaces/:workspaceId/approvals', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const status = isApprovalStatus(req.query.status) ? req.query.status : undefined;
      const approvals = await deps.approvalEngine.list(workspaceId, status);
      res.json({ approvals });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/approvals/:approvalId', async (req, res, next) => {
    try {
      const { workspaceId, approvalId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(approvalId)) {
        res.status(400).json({ error: 'workspaceId and approvalId must be valid UUIDs' });
        return;
      }

      const approval = await deps.approvalEngine.get(workspaceId, approvalId);
      res.json({ approval });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/approvals/:approvalId/approve', async (req, res, next) => {
    try {
      const { workspaceId, approvalId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(approvalId)) {
        res.status(400).json({ error: 'workspaceId and approvalId must be valid UUIDs' });
        return;
      }

      const decision = await deps.approvalEngine.approve(workspaceId, approvalId);
      res.json({ decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/approvals/:approvalId/reject', async (req, res, next) => {
    try {
      const { workspaceId, approvalId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(approvalId)) {
        res.status(400).json({ error: 'workspaceId and approvalId must be valid UUIDs' });
        return;
      }

      const decision = await deps.approvalEngine.reject(workspaceId, approvalId);
      res.json({ decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof PendingApprovalNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof PendingApprovalExpiredError) {
    res.status(410).json({ error: error.message });
    return;
  }
  if (error instanceof PendingApprovalAlreadyResolvedError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
