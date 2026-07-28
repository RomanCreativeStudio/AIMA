import { Router, type Response } from 'express';
import { OAuthStateInvalidError } from '../oauth/errors';
import type { OAuthService } from '../oauth/oauthService';
import { isIntegrationProvider } from '../integrations/types';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface OAuthRouterDependencies {
  oauthService: OAuthService;
}

/**
 * The OAuth Framework's API (Phase 2.7, item 4): starting a connection and
 * completing it. `start` is workspace-scoped and returns a plain JSON
 * `authorizationUrl` — the client (the macOS app) opens it in the system
 * browser itself rather than this route redirecting, keeping every other
 * route in this API JSON-only. `callback` is the one genuinely
 * provider-driven endpoint: Google/GitHub redirect the user's browser here
 * directly with `code`/`state` (or `error`) as query parameters, so it
 * can't be workspace-scoped in the path — the workspace and provider are
 * recovered from `state`, which `OAuthService` itself issued and verifies.
 * It renders a minimal static HTML page rather than JSON, since a browser
 * — not a fetch client — lands here.
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
      await deps.oauthService.completeAuthorization(provider, code, state);
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
