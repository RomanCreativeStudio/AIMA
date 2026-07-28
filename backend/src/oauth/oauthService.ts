import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import type { IntegrationService } from '../integrations/integrationService';
import type { IntegrationProvider, WorkspaceIntegration } from '../integrations/types';
import { OAuthStateInvalidError } from './errors';
import type { OAuthProvider } from './types';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a user to complete a browser consent screen, short enough to bound a CSRF token's window.

interface PendingState {
  workspaceId: string;
  provider: IntegrationProvider;
  expiresAt: number;
}

/**
 * The OAuth Framework's orchestrator (Phase 2.7, item 4): starts an
 * authorization-code flow and completes it once the provider redirects
 * back with a code. `state` is a random, single-use, short-lived token this
 * process itself issued — verified on completion so a callback can't be
 * replayed or forged into connecting the wrong workspace. Deliberately
 * in-memory (not a DB table): it is a CSRF nonce with a ten-minute lifetime,
 * not durable state — losing pending flows on a backend restart is an
 * acceptable, documented tradeoff (docs/decisions/0015-live-integration-
 * providers.md), not a new persistence concern worth a migration.
 */
export class OAuthService {
  private readonly pendingStates = new Map<string, PendingState>();

  constructor(
    private readonly db: Queryable,
    private readonly oauthProviders: Partial<Record<IntegrationProvider, OAuthProvider>>,
    private readonly integrationService: IntegrationService,
  ) {}

  async startAuthorization(workspaceId: string, provider: IntegrationProvider): Promise<{ authorizationUrl: string }> {
    await this.assertWorkspaceExists(workspaceId);
    const oauthProvider = this.getProvider(provider);

    this.sweepExpiredStates();
    const state = randomBytes(24).toString('base64url');
    this.pendingStates.set(state, { workspaceId, provider, expiresAt: Date.now() + STATE_TTL_MS });

    return { authorizationUrl: oauthProvider.getAuthorizationUrl(state) };
  }

  /** Invoked by `GET /api/oauth/:provider/callback` once the user approves consent — exchanges the code, then connects through the existing `IntegrationService`, reusing its encrypted credential storage unchanged. */
  async completeAuthorization(provider: IntegrationProvider, code: string, state: string): Promise<WorkspaceIntegration> {
    const pending = this.pendingStates.get(state);
    if (!pending || pending.provider !== provider || pending.expiresAt < Date.now()) {
      this.pendingStates.delete(state);
      throw new OAuthStateInvalidError();
    }
    this.pendingStates.delete(state); // single-use

    const oauthProvider = this.getProvider(provider);
    const tokens = await oauthProvider.exchangeCode(code);

    return this.integrationService.connect({
      workspaceId: pending.workspaceId,
      provider,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? '',
        expiresAt: tokens.expiresAt ?? '',
      },
    });
  }

  private getProvider(provider: IntegrationProvider): OAuthProvider {
    const oauthProvider = this.oauthProviders[provider];
    if (!oauthProvider) {
      throw new Error(`No OAuth provider configured for "${provider}"`);
    }
    return oauthProvider;
  }

  private sweepExpiredStates(): void {
    const now = Date.now();
    for (const [state, pending] of this.pendingStates) {
      if (pending.expiresAt < now) {
        this.pendingStates.delete(state);
      }
    }
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}
