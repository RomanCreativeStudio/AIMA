import type { IntegrationProvider } from '../integrations/types';
import { OAuthExchangeFailedError } from './errors';
import type { OAuthProvider, OAuthTokenSet } from './types';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Scopes for the two Google-backed providers this phase ships — `gmail.send`/`gmail.modify` cover Send Email, Save Draft, Read Inbox, Read Unread, and Search Messages; `calendar` covers list/read/create/update/delete. */
export const GOOGLE_OAUTH_SCOPES: Record<'gmail' | 'calendar', string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
};

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Google's OAuth 2.0 authorization-code flow (Phase 2.7, item 4) — shared by
 * `gmail` and `calendar` (both Google APIs), parameterized by scope so one
 * class serves both rather than duplicating the identical token/refresh/
 * revoke logic twice. `access_type=offline` + `prompt=consent` on the
 * authorization URL is what makes Google reliably return a `refresh_token`
 * on first consent — omitting either one risks Google silently not issuing
 * one on a repeat authorization.
 */
export class GoogleOAuthProvider implements OAuthProvider {
  constructor(
    readonly provider: IntegrationProvider,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly scopes: string[],
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokenSet> {
    return this.requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    const tokens = await this.requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
    // Google typically omits `refresh_token` on a refresh response — the original one stays valid and must be preserved by the caller.
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  }

  async revokeToken(accessToken: string): Promise<void> {
    await this.fetchFn(`${REVOKE_ENDPOINT}?${new URLSearchParams({ token: accessToken }).toString()}`, {
      method: 'POST',
    });
  }

  private async requestTokens(body: Record<string, string>): Promise<OAuthTokenSet> {
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...body,
      }).toString(),
    });

    const payload = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || payload.error) {
      throw new OAuthExchangeFailedError(this.provider, payload.error_description ?? payload.error ?? `HTTP ${response.status}`);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
      scope: payload.scope,
    };
  }
}
