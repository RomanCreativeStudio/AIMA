import type { NextFunction, RequestHandler, Response } from 'express';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkspaceService } from '../workspaces/workspaceService';
import { isUuid } from '../util/uuid';
import type { AuthenticatedRequest } from './auth';

/**
 * Authorization foundation (ADR-0022 Decision 5): confirms the
 * authenticated identity (`req.identity`, set by `requireAuth`, which must
 * run first) owns the workspace named by `req.params[paramName]`. Throws
 * the same `WorkspaceNotFoundError` — mapped to a uniform 404 — for both
 * "workspace does not exist" and "workspace belongs to another user", so a
 * cross-user access attempt cannot be distinguished from a typo'd ID. This
 * is a workspace-ownership check only; it does not replace or duplicate
 * the Permission Engine's per-capability authorization boundary
 * (docs/decisions — Permission Engine), which remains a separate layer.
 *
 * A malformed (non-UUID) workspaceId is rejected with 400 before ever
 * reaching `WorkspaceService` — this mirrors the `isUuid` check every
 * workspace-scoped route already performs itself (EPIC-004 Sprint 4.5),
 * and avoids passing a non-UUID literal into a `uuid`-typed SQL column,
 * which Postgres would otherwise reject as a query error (500), not a
 * routine validation failure.
 */
export function requireWorkspaceOwnership(
  workspaceService: WorkspaceService,
  paramName: string = 'workspaceId',
): RequestHandler {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params[paramName];
      const userId = req.identity?.userId;

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: `${paramName} must be a valid UUID` });
        return;
      }

      const workspace = await workspaceService.getWorkspace(workspaceId);
      if (workspace.userId !== userId) {
        throw new WorkspaceNotFoundError(workspaceId);
      }

      next();
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}
