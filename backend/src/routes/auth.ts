import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { AuthProvider } from '../auth/types';
import { AuthLoginFailedError, AuthRefreshFailedError, SessionRevokedError } from '../auth/errors';
import type { SessionService } from '../auth/sessionService';
import { UserNotFoundError } from '../users/errors';
import type { UserService } from '../users/userService';
import { isUuid } from '../util/uuid';

export interface AuthRouterDependencies {
  authProvider: AuthProvider;
  sessionService: SessionService;
  userService: UserService;
}

/**
 * The client-accessible authentication HTTP surface (EPIC-004 Sprint 4.6,
 * ADR-0022) — split into two routers, the same public/protected pattern
 * `oauthRouter`/`oauthCallbackRouter` established in Sprint 4.5, because
 * login and refresh must be reachable without an already-valid access
 * token. `authPublicRouter` (login, refresh) is mounted ahead of
 * `backend/src/app.ts`'s blanket `requireAuth` gate; `authRouter` (logout,
 * session listing/deletion) is mounted after it like every other
 * resource router.
 */
export function authPublicRouter(deps: AuthRouterDependencies): Router {
  const router = Router();

  router.post('/auth/login', async (req, res, next) => {
    try {
      const { email, password, deviceLabel } = req.body ?? {};

      if (typeof email !== 'string' || !email.includes('@')) {
        res.status(400).json({ error: 'email must be a valid email address' });
        return;
      }
      if (typeof password !== 'string' || password.length === 0) {
        res.status(400).json({ error: 'password is required' });
        return;
      }

      let tokens;
      try {
        tokens = await deps.authProvider.signInWithPassword(email, password);
      } catch (error) {
        if (error instanceof AuthLoginFailedError) {
          res.status(401).json({ error: 'Invalid email or password' });
          return;
        }
        throw error;
      }

      // IssuedTokens carries no resolved subject id — reuse the already-
      // tested, local (no network call) verification path to recover it,
      // rather than widening the shared IssuedTokens shape.
      const verified = await deps.authProvider.verifyAccessToken(tokens.accessToken);
      if (!verified) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      let user;
      try {
        user = await deps.userService.getUser(verified.subjectId);
      } catch (error) {
        if (error instanceof UserNotFoundError) {
          res.status(401).json({ error: 'Invalid email or password' });
          return;
        }
        throw error;
      }

      const session = await deps.sessionService.createSession(
        user.id,
        tokens.refreshToken,
        typeof deviceLabel === 'string' ? deviceLabel : undefined,
      );

      res.status(201).json({ tokens, session });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/refresh', async (req, res, next) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        res.status(400).json({ error: 'refreshToken is required' });
        return;
      }

      const { tokens, session } = await deps.sessionService.refresh(refreshToken);
      res.json({ tokens, session });
    } catch (error) {
      if (error instanceof SessionRevokedError || error instanceof AuthRefreshFailedError) {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
        return;
      }
      next(error);
    }
  });

  return router;
}

/** The protected half of the authentication API — see `authPublicRouter`'s doc comment for why login/refresh must stay separate. */
export function authRouter(deps: AuthRouterDependencies): Router {
  const router = Router();

  router.post('/auth/logout', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { refreshToken, allSessions } = req.body ?? {};
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        res.status(400).json({ error: 'refreshToken is required' });
        return;
      }

      const userId = req.identity!.userId;
      const session = await deps.sessionService.findByRefreshToken(refreshToken);
      if (!session || session.userId !== userId) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (allSessions === true) {
        const sessions = await deps.sessionService.listSessions(userId);
        await Promise.all(sessions.map((s) => deps.sessionService.revokeSession(s.id)));
      } else {
        await deps.sessionService.revokeSession(session.id);
      }

      await deps.authProvider.revokeSession(refreshToken);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get('/auth/sessions', async (req: AuthenticatedRequest, res, next) => {
    try {
      const sessions = await deps.sessionService.listSessions(req.identity!.userId);
      res.json({ sessions });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/auth/sessions/:sessionId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { sessionId } = req.params;
      if (!isUuid(sessionId)) {
        res.status(400).json({ error: 'sessionId must be a valid UUID' });
        return;
      }

      const session = await deps.sessionService.getSession(sessionId);
      if (!session || session.userId !== req.identity!.userId) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await deps.sessionService.revokeSession(sessionId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
