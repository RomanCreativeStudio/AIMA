import { Router } from 'express';
import type { AdminService } from '../admin/adminService';
import { requireAdmin } from '../middleware/requireAdmin';

export interface AdminRouterDependencies {
  adminService: AdminService;
  adminUserIds: readonly string[];
}

/**
 * Internal Operator Dashboard sprint: the founder/admin-only surface. Every route here is gated by
 * `requireAdmin` in addition to the blanket `requireAuth` every other `/api` route already sits behind —
 * this router is only ever mounted (`app.ts`) when both `adminService` and `adminUserIds` are supplied, so
 * an environment with no configured admin simply has no `/api/admin/*` routes at all.
 */
export function adminRouter(deps: AdminRouterDependencies): Router {
  const router = Router();
  router.use(requireAdmin(deps.adminUserIds));

  router.get('/admin/beta-users', async (req, res, next) => {
    try {
      const users = await deps.adminService.listBetaUsers();
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/feedback', async (req, res, next) => {
    try {
      const rawLimit = req.query.limit;
      const limit = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit) ? Number(rawLimit) : undefined;
      const feedback = await deps.adminService.listRecentFeedback(limit);
      res.json({ feedback });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
