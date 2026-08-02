import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import { OAuthStateInvalidError } from '../oauth/errors';
import type { OAuthService } from '../oauth/oauthService';
import { isIntegrationProvider } from '../integrations/types';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface OAuthRouterDependencies {
  oauthService: OAuthService;
}

export interface OAuthCallbackRouterDependencies extends OAuthRouterDependencies {
  actionLogger: ActionLogger;
}

/**
 * The OAuth Framework's API (Phase 2.7, item 4): starting a connection and
 * completing it — split into two routers (EPIC-004 Sprint 4.5) because the
 * two routes have opposite authentication requirements. `oauthRouter`'s
 * `start` route is workspace-scoped and returns a plain JSON
 * `authorizationUrl` — the client (the macOS app) opens it in the system
 * browser itself rather than this route redirecting, keeping every other
 * route in this API JSON-only; it requires an authenticated, owning caller
 * like every other workspace resource (`backend/src/app.ts`'s
 * `/api/workspaces/:workspaceId` gate covers it). `oauthCallbackRouter`'s
 * `callback` route is the one genuinely provider-driven endpoint:
 * Google/GitHub redirect the user's browser here directly with
 * `code`/`state` (or `error`) as query parameters, carrying no AIMA
 * Authorization header — it can't require `requireAuth` and can't be
 * workspace-scoped in the path either way. The workspace and provider are
 * instead recovered from `state`, which `OAuthService` itself issued and
 * verifies — that is this route's actual authorization mechanism. It
 * renders a minimal static HTML page rather than JSON, since a browser —
 * not a fetch client — lands here.
 */
export function oauthRouter(deps: OAuthRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/integrations/:provider/oauth/start', async (req, res, next) => {
    try {
      const { workspaceId, provider } = req.params;
      if (!isUuid(workspaceId) || !isIntegrationProvider(provider)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID and provider must be a known integration' });
        return;
      }

      const { authorizationUrl } = await deps.oauthService.startAuthorization(workspaceId, provider);
      res.json({ authorizationUrl });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}

/** The public half of the OAuth Framework's API — see `oauthRouter`'s doc comment for why this must stay separate and unauthenticated. */
export function oauthCallbackRouter(deps: OAuthCallbackRouterDependencies): Router {
  const router = Router();

  router.get('/oauth/:provider/callback', async (req, res) => {
    const { provider } = req.params;
    const { code, state, error: providerError } = req.query;

    if (!isIntegrationProvider(provider)) {
      renderResult(res, 400, false, `Unknown provider "${provider}".`);
      return;
    }
    if (typeof providerError === 'string' && providerError.length > 0) {
      renderResult(res, 400, false, `${displayName(provider)} declined the connection: ${providerError}.`);
      return;
    }
    if (typeof code !== 'string' || typeof state !== 'string') {
      renderResult(res, 400, false, 'Missing authorization code or state.');
      return;
    }

    try {
      const integration = await deps.oauthService.completeAuthorization(provider, code, state);
      // The one real "credential established" event this flow produces —
      // the security-relevant moment worth an audit trail (EPIC-007 Sprint
      // 7.1). `state`'s own validity check inside `completeAuthorization`
      // is this route's authorization mechanism (see doc comment above), so
      // by the time this succeeds, `integration.workspaceId` is a real,
      // verified workspace, safe to log against.
      await deps.actionLogger.log({
        workspaceId: integration.workspaceId,
        tier: 'prepare',
        summary: `Connected ${provider} via OAuth`,
        payload: { provider },
        outcome: 'success',
      });
      renderResult(res, 200, true, `${displayName(provider)} is now connected. You can close this window and return to AIMA.`);
    } catch (error) {
      if (error instanceof OAuthStateInvalidError) {
        renderResult(res, 400, false, error.message);
        return;
      }
      renderResult(res, 502, false, error instanceof Error ? error.message : 'Connection failed.');
    }
  });

  return router;
}

function displayName(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function renderResult(res: Response, statusCode: number, success: boolean, message: string): void {
  const title = success ? 'Connected' : 'Connection failed';
  res
    .status(statusCode)
    .type('html')
    .send(
      `<!doctype html><html><head><title>${title} — AIMA</title></head>` +
        `<body style="font-family: -apple-system, sans-serif; text-align: center; padding: 3rem;">` +
        `<h1>${title}</h1><p>${escapeHtml(message)}</p></body></html>`,
    );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
