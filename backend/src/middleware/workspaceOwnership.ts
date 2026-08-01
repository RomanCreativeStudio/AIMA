import type { NextFunction, RequestHandler, Response } from 'express';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkspaceService } from '../workspaces/workspaceService';
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
