import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { WorkspaceDigestService } from '../insights/workspaceDigestService';

export interface DigestRouterDependencies {
  workspaceDigestService: WorkspaceDigestService;
}

/**
 * Cross-Workspace Daily Digest sprint: one read-only GET, strictly scoped to the authenticated caller's own
 * workspaces. `userId` always comes from `req.identity!.userId` — never a client-supplied value — matching
 * `POST /workspaces`'s precedent in `workspaces.ts` (ADR-0022 Decision 4/5): a workspace list must never be
 * guessable or spoofable from the URL. No capability, no `ActionLogger.log` — the same "read-only intelligence"
 * rule `proactiveRouter`/`insights.ts` already follow. A distinct top-level path (not nested under `/workspaces`)
 * so it can't collide with `GET /workspaces/:workspaceId`'s UUID-validated param regardless of router mount order.
 */
export function digestRouter(deps: DigestRouterDependencies): Router {
  const router = Router();

  router.get('/digest', async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.identity!.userId;
      const digest = await deps.workspaceDigestService.getDigest(userId);
      res.json({ digest });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
