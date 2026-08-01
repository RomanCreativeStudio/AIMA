import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthProvider } from '../auth/types';

/** The identity `requireAuth` attaches once a request's access token verifies. */
export interface RequestIdentity {
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  identity?: RequestIdentity;
}

/**
 * Authentication middleware (ADR-0022 Decision 2/4): validates the
 * `Authorization: Bearer <token>` header against `authProvider` and injects
 * the resolved identity as `req.identity`. Rejects with 401 for a missing
 * header, malformed header, invalid signature, or expired token — the
 * `AuthProvider.verifyAccessToken` contract deliberately collapses all of
 * these into one outcome (`null`), so this middleware does the same rather
 * than trying to distinguish them.
 */
export function requireAuth(authProvider: AuthProvider): RequestHandler {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const accessToken = header.slice('Bearer '.length).trim();
    if (!accessToken) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const verified = await authProvider.verifyAccessToken(accessToken);
    if (!verified) {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    req.identity = { userId: verified.subjectId };
    next();
  };
}
