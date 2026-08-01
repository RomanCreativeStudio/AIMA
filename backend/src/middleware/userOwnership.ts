import type { NextFunction, RequestHandler, Response } from 'express';
import { UserNotFoundError } from '../users/errors';
import type { AuthenticatedRequest } from './auth';

/**
 * Confirms the authenticated caller (`req.identity`, set by `requireAuth`,
 * which must run first) is requesting their own user-scoped resource
 * (`/users/:userId`, `/users/:userId/workspaces`). Because `users.id` *is*
 * the provider's subject identifier (ADR-0022 Decision 4), this is a pure
 * parameter comparison — no database lookup needed, unlike
 * `requireWorkspaceOwnership`. Returns the same `UserNotFoundError`-shaped
 * 404 a genuinely unknown user id gets, mirroring `requireWorkspaceOwnership`'s
 * uniform-404 treatment (ADR-0022 Decision 5) so a cross-user attempt can't
 * be distinguished from a typo'd id.
 */
export function requireUserOwnership(paramName: string = 'userId'): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const targetUserId = req.params[paramName];
    const callerId = req.identity?.userId;

    if (!callerId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (targetUserId !== callerId) {
      res.status(404).json({ error: new UserNotFoundError(targetUserId).message });
      return;
    }

    next();
  };
}
