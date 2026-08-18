import { OAuthExchangeFailedError } from './errors';
import type { OAuthProvider, OAuthTokenSet } from './types';

const AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize';
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';

function revokeEndpoint(clientId: string): string {
  return `https://api.github.com/applications/${clientId}/grant`;
}

/** `repo` covers Create Issue, Create Pull Request, Read Repositories, Read Issues, and Read Pull Requests against both public and private repositories. */
export const GITHUB_OAUTH_SCOPES = ['repo'];

interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * GitHub's OAuth 2.0 authorization-code flow (Phase 2.7, item 4). Classic
 * GitHub OAuth Apps issue non-expiring access tokens with no refresh token
 * by default — `refresh_token`/`expires_in` only appear in the response if
 * the app has opted into token expiration, so `exchangeCode`/
 * `refreshAccessToken` treat both as optional and pass through whatever the
 * response actually contains rather than assuming either shape.
 */
export class GitHubOAuthProvider implements OAuthProvider {
  readonly provider = 'github' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: GITHUB_OAUTH_SCOPES.join(' '),
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
    return this.requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revokeToken(accessToken: string): Promise<void> {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    await this.fetchFn(revokeEndpoint(this.clientId), {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
  }

  private async requestTokens(body: Record<string, string>): Promise<OAuthTokenSet> {
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...body,
      }).toString(),
    });

    const payload = (await response.json()) as GitHubTokenResponse;
    if (!response.ok || payload.error || !payload.access_token) {
      throw new OAuthExchangeFailedError('github', payload.error_description ?? payload.error ?? `HTTP ${response.status}`);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
      scope: payload.scope,
    };
  }
}
