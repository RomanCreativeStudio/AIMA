import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { ipKey, normalizeEmail, rateLimitMiddleware, respondRateLimited, type RateLimiter } from '../middleware/rateLimit';
import type { AuthProvider } from '../auth/types';
import { AuthLoginFailedError, AuthRefreshFailedError, SessionRevokedError } from '../auth/errors';
import type { SessionService } from '../auth/sessionService';
import type { InvitationService } from '../invitations/invitationService';
import type { Logger } from '../logging/types';
import type { UserService } from '../users/userService';
import { isUuid } from '../util/uuid';

export interface AuthRouterDependencies {
  authProvider: AuthProvider;
  sessionService: SessionService;
  userService: UserService;
  /** Invitation Acceptance & Lifecycle sprint: optional for the same reason as every other optional
   * dependency in this codebase — a caller that never supplies one (every pre-existing test included) simply
   * gets no invitation-acceptance behavior on login, not an error. */
  invitationService?: InvitationService;
  /** Used only to log (never throw on) an invitation-acceptance failure during login — see the login
   * handler's own comment for why that failure must never affect the login itself. */
  logger?: Logger;
}

/**
 * `authPublicRouter`'s dependencies, extending the base set with the rate
 * limiters login/refresh need (ADR-0023, REQ-001 criterion 5) — required,
 * not optional, mirroring `authProvider`'s own "no safe default that keeps
 * the app secure if a call site forgets to supply one" rationale
 * (`backend/src/app.ts`): silently omitting these would silently reopen
 * the unrate-limited credential-stuffing gap this requirement exists to
 * close. `authRouter` (logout/sessions) doesn't need them — those routes
 * already sit behind `requireAuth`, so brute-forcing them isn't the same
 * threat. `index.ts`, the one real production call site, always
 * constructs real limiters via `authRateLimitConfigFromEnv`.
 */
export interface AuthPublicRouterDependencies extends AuthRouterDependencies {
  loginEmailRateLimiter: RateLimiter;
  loginIpRateLimiter: RateLimiter;
  refreshIpRateLimiter: RateLimiter;
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
export function authPublicRouter(deps: AuthPublicRouterDependencies): Router {
  const router = Router();

  // Coarse per-IP backstop (ADR-0023): runs ahead of body parsing/validation
  // so it also catches a flood of malformed requests, not just well-formed
  // ones. The account-specific check (per-email, tighter) runs inside the
  // handler below, once the body is parsed and `email` is validated.
  router.post('/auth/login', rateLimitMiddleware(deps.loginIpRateLimiter, ipKey), async (req, res, next) => {
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

      const emailKey = normalizeEmail(email);
      const emailLimit = deps.loginEmailRateLimiter.consume(emailKey);
      if (!emailLimit.allowed) {
        respondRateLimited(res, emailLimit.retryAfterSeconds);
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

      // Auto-provisions the public.users profile on first login (ADR-0022
      // v1.1, EPIC-006 Sprint 6.4): a verified Supabase Auth identity with
      // no matching local row yet — the exact gap that caused a real
      // production login failure before this sprint — gets one created
      // here instead of failing with a misleading "invalid credentials."
      const { user, isNewProfile } = await deps.userService.getOrProvisionFromAuth(verified.subjectId, verified.email);

      // Invitation Acceptance & Lifecycle sprint: only a genuine first-time signup ever consumes an
      // invitation — `isNewProfile` is exactly that signal, so a returning user's login never re-triggers
      // this even if the founder later re-invites their already-registered address. Must never fail (or
      // delay) login: a lookup/update error here is logged and swallowed, the same "log only, never break
      // the primary flow" posture `WebhookNotificationService` already established.
      if (isNewProfile && deps.invitationService) {
        try {
          await deps.invitationService.acceptInvitationFor(user.email, user.id);
        } catch (error) {
          deps.logger?.warn('Invitation acceptance failed during signup', {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const session = await deps.sessionService.createSession(
        user.id,
        tokens.refreshToken,
        typeof deviceLabel === 'string' ? deviceLabel : undefined,
      );

      // Successful authentication resets both counters (REQ-001 criterion
      // 5) — a legitimate caller who mistyped their password a couple of
      // times isn't left soft-locked for the rest of the window once they
      // get it right.
      deps.loginEmailRateLimiter.reset(emailKey);
      deps.loginIpRateLimiter.reset(ipKey(req));

      res.status(201).json({ tokens, session });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/refresh', rateLimitMiddleware(deps.refreshIpRateLimiter, ipKey), async (req, res, next) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        res.status(400).json({ error: 'refreshToken is required' });
        return;
      }

      const { tokens, session } = await deps.sessionService.refresh(refreshToken);
      deps.refreshIpRateLimiter.reset(ipKey(req));
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
