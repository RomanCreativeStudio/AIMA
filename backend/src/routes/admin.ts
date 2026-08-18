import { Router } from 'express';
import type { Response } from 'express';
import type { AdminService } from '../admin/adminService';
import type { UpdateBetaTesterInput } from '../admin/types';
import { FeedbackNotFoundError, InvalidFeedbackStatusTransitionError } from '../feedback/errors';
import { FEEDBACK_STATUSES, type FeedbackStatus } from '../feedback/types';
import { UserAlreadyBetaTesterError } from '../invitations/errors';
import type { InvitationService } from '../invitations/invitationService';
import type { AuthenticatedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { UserNotFoundError } from '../users/errors';
import { isUuid } from '../util/uuid';

export interface AdminRouterDependencies {
  adminService: AdminService;
  adminUserIds: readonly string[];
  invitationService?: InvitationService;
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
      const query = readQueryParam(req.query.query);
      const users = await deps.adminService.listBetaUsers(query);
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  /** Beta Tester Management sprint: every account, not just current beta testers — the view used to find a candidate to promote/demote or annotate. */
  router.get('/admin/users', async (req, res, next) => {
    try {
      const query = readQueryParam(req.query.query);
      const users = await deps.adminService.listAllUsers(query);
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/admin/users/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) {
        res.status(400).json({ error: 'id must be a valid UUID' });
        return;
      }

      const body = req.body as { betaTester?: unknown; adminNotes?: unknown; adminTags?: unknown };
      const updates: UpdateBetaTesterInput = {};

      if (body.betaTester !== undefined) {
        if (typeof body.betaTester !== 'boolean') {
          res.status(400).json({ error: 'betaTester must be a boolean if provided' });
          return;
        }
        updates.betaTester = body.betaTester;
      }

      if (body.adminNotes !== undefined) {
        if (typeof body.adminNotes !== 'string') {
          res.status(400).json({ error: 'adminNotes must be a string if provided' });
          return;
        }
        updates.adminNotes = body.adminNotes;
      }

      if (body.adminTags !== undefined) {
        if (!Array.isArray(body.adminTags) || !body.adminTags.every((tag) => typeof tag === 'string')) {
          res.status(400).json({ error: 'adminTags must be an array of strings if provided' });
          return;
        }
        updates.adminTags = body.adminTags;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'at least one of betaTester, adminNotes, adminTags must be provided' });
        return;
      }

      const user = await deps.adminService.updateUserBetaStatus(id, updates);
      res.json({ user });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  /** Founder Analytics Dashboard sprint: platform-wide totals for the founder dashboard's metric cards. */
  router.get('/admin/analytics', async (req, res, next) => {
    try {
      const analytics = await deps.adminService.getPlatformAnalytics();
      res.json({ analytics });
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

  // Beta Invitations & Notifications sprint: optional-dependency pattern — these routes only exist when
  // `invitationService` was supplied (mirrors how the whole `adminRouter` itself is only mounted when its
  // deps are present in `app.ts`), rather than existing unconditionally and 404ing per-request.
  if (deps.invitationService) {
    const invitationService = deps.invitationService;

    router.post('/admin/invitations', async (req: AuthenticatedRequest, res, next) => {
      try {
        const { email } = req.body as { email?: unknown };
        if (typeof email !== 'string' || !email.includes('@')) {
          res.status(400).json({ error: 'email must be a valid email address' });
          return;
        }

        const invitation = await invitationService.createInvitation({
          email,
          invitedBy: req.identity!.userId,
        });
        res.status(201).json({ invitation });
      } catch (error) {
        handleKnownErrors(error, res, next);
      }
    });

    router.get('/admin/invitations', async (req, res, next) => {
      try {
        const invitations = await invitationService.listInvitations();
        res.json({ invitations });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}

function readQueryParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof FeedbackNotFoundError || error instanceof UserNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidFeedbackStatusTransitionError) {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof UserAlreadyBetaTesterError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
