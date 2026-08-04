import type { NextFunction, RequestHandler, Response } from 'express';
import type { AuthenticatedRequest } from './auth';

/**
 * Internal Operator Dashboard sprint: gates the new `/api/admin/*` routes to a small, env-configured
 * allowlist of user ids (`ADMIN_USER_IDS`) — deliberately not a database column. There is no `is_admin`
 * concept anywhere in this schema, and adding one would be a schema change for a single-operator MVP where
 * the allowlist is realistically one or two ids; an env var is the smaller, reversible choice.
 *
 * Runs after `requireAuth`, so `req.identity` is already set — the founder authenticates exactly like any
 * other user, this is just an extra check layered on top for a few specific routes.
 *
 * Responds 403, not `requireWorkspaceOwnership`'s uniform 404 — there's no enumeration concern to hide
 * here (unlike a workspace id, "you're not an admin" reveals nothing about any other account or resource),
 * so there's no reason to obscure which failure occurred.
 */
export function requireAdmin(adminUserIds: readonly string[]): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.identity?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!adminUserIds.includes(userId)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    next();
  };
}
