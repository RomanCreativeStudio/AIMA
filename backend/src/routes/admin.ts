import { Router } from 'express';
import type { Response } from 'express';
import type { AdminService } from '../admin/adminService';
import { FeedbackNotFoundError, InvalidFeedbackStatusTransitionError } from '../feedback/errors';
import { FEEDBACK_STATUSES, type FeedbackStatus } from '../feedback/types';
import { requireAdmin } from '../middleware/requireAdmin';
import { isUuid } from '../util/uuid';

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

  router.patch('/admin/feedback/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) {
        res.status(400).json({ error: 'id must be a valid UUID' });
        return;
      }

      const { status } = req.body as { status?: unknown };
      if (typeof status !== 'string' || !FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
        res.status(400).json({ error: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}` });
        return;
      }

      const feedback = await deps.adminService.updateFeedbackStatus(id, status as FeedbackStatus);
      res.json({ feedback });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof FeedbackNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidFeedbackStatusTransitionError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
