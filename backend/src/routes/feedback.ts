import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { FeedbackService } from '../feedback/feedbackService';
import { FEEDBACK_TYPES, type FeedbackType } from '../feedback/types';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface FeedbackRouterDependencies {
  feedbackService: FeedbackService;
}

/**
 * Beta Tester Infrastructure sprint: submit/list feedback, bug reports, and feature requests. Ungated (no
 * PermissionEngine/ActionLogger) — submitting feedback is not a conversational capability an AI intent
 * would trigger, the same reasoning `usersRouter`/`workspacesRouter` already use for account/workspace-setup
 * operations. Workspace ownership is enforced by the existing path-scoped `requireWorkspaceOwnership`
 * middleware (`app.ts`), not repeated here.
 */
export function feedbackRouter(deps: FeedbackRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/feedback', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { type, message } = req.body ?? {};

      if (type !== undefined && !isFeedbackType(type)) {
        res.status(400).json({ error: `type must be one of: ${FEEDBACK_TYPES.join(', ')}` });
        return;
      }
      if (typeof message !== 'string' || message.trim().length === 0) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      // The submitter is the authenticated caller, never a client-supplied value (same pattern as
      // workspacesRouter's POST /workspaces) — requireAuth guarantees req.identity is set before this runs.
      const feedback = await deps.feedbackService.createFeedback({
        workspaceId,
        userId: req.identity!.userId,
        type,
        message,
      });

      res.status(201).json({ feedback });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/feedback', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const feedback = await deps.feedbackService.listFeedback(workspaceId);
      res.json({ feedback });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isFeedbackType(value: unknown): value is FeedbackType {
  return typeof value === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
