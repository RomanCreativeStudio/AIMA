import { AuthRefreshFailedError } from './errors';
import { verifyJwtRs256, type Jwks } from './jwt';
import type { AuthProvider, IssuedTokens, VerifiedAccessToken } from './types';

interface SupabaseTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  msg?: string;
}

const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Supabase Auth (GoTrue) implementation of `AuthProvider` (ADR-0022
 * Decision 1). Takes an injectable `fetch`, the same "one endpoint doesn't
 * need a whole SDK" precedent as `GitHubOAuthProvider`/
 * `OpenAISpeechToTextProvider` — the backend test suite exercises real
 * request/response shapes against a fake HTTP layer, never a live network
 * call, since this environment cannot register a real Supabase project or
 * run a live end-to-end test against one.
 *
 * `verifyAccessToken` fetches the project's published JWKS once and caches
 * it for this instance's lifetime (JWKS rotates rarely; a full
 * cache-invalidation strategy is out of scope for this foundation layer)
 * and verifies locally — no network call per request, per ADR-0022
 * Decision 2.
 */
export class SupabaseAuthProvider implements AuthProvider {
  private jwksCache: Jwks | null = null;

  constructor(
    private readonly projectUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async verifyAccessToken(accessToken: string): Promise<VerifiedAccessToken | null> {
    let jwks: Jwks;
    try {
      jwks = await this.getJwks();
    } catch {
      return null;
    }

    const claims = verifyJwtRs256(accessToken, jwks);
    if (!claims) return null;

    const exp = claims.exp;
    const sub = claims.sub;
    if (typeof exp !== 'number' || typeof sub !== 'string' || !sub) return null;
    if (exp * 1000 <= Date.now()) return null;

    return { subjectId: sub, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async refreshSession(refreshToken: string): Promise<IssuedTokens> {
    const response = await this.fetchFn(`${this.tokenUrl()}?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const payload = (await response.json()) as SupabaseTokenResponse;
    if (!response.ok || !payload.access_token || !payload.refresh_token) {
      throw new AuthRefreshFailedError(
        'supabase',
        payload.error_description ?? payload.msg ?? payload.error ?? `HTTP ${response.status}`,
      );
    }

    const accessTokenExpiresAt = payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : new Date(Date.now() + DEFAULT_ACCESS_TOKEN_TTL_MS).toISOString();

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessTokenExpiresAt,
    };
  }

  async revokeSession(token: string): Promise<void> {
    // Best-effort courtesy call (AuthProvider.revokeSession's documented
    // contract) — local revocation (auth_sessions.revoked_at) is
    // authoritative per ADR-0022 Decision 3, so a failure here is
    // deliberately swallowed, not surfaced.
    await this.fetchFn(this.logoutUrl(), {
      method: 'POST',
      headers: { apikey: this.apiKey, Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }

  private tokenUrl(): string {
    return `${this.baseUrl()}/auth/v1/token`;
  }

  private logoutUrl(): string {
    return `${this.baseUrl()}/auth/v1/logout`;
  }

  private jwksUrl(): string {
    return `${this.baseUrl()}/auth/v1/.well-known/jwks.json`;
  }

  private baseUrl(): string {
    return this.projectUrl.replace(/\/+$/, '');
  }

  private async getJwks(): Promise<Jwks> {
    if (this.jwksCache) return this.jwksCache;

    const response = await this.fetchFn(this.jwksUrl(), { headers: { apikey: this.apiKey } });
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS from Supabase: HTTP ${response.status}`);
    }

    const jwks = (await response.json()) as Jwks;
    this.jwksCache = jwks;
    return jwks;
  }
}
