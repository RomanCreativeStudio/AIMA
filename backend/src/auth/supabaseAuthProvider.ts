import { AuthLoginFailedError, AuthRefreshFailedError } from './errors';
import { verifyJwtSignature, type Jwks } from './jwt';
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
 * `OpenAISpeechToTextProvider` — the mock-fixture backend test suite
 * exercises real request/response shapes against a fake HTTP layer, never a
 * live network call. Separately, EPIC-004 Sprint 4.9 verified this class
 * end-to-end against a real, active Supabase project (login, refresh,
 * token verification, logout) — see `docs/requirements/REQ-001-authentication.md`
 * for the verification record; that live project issues ES256-signed
 * tokens, which is why `verifyJwtSignature` (`./jwt.ts`) supports both
 * ES256 and RS256 rather than only the latter.
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

  async signInWithPassword(email: string, password: string): Promise<IssuedTokens> {
    const response = await this.fetchFn(`${this.tokenUrl()}?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ email, password }),
    });

    const payload = (await response.json()) as SupabaseTokenResponse;
    if (!response.ok || !payload.access_token || !payload.refresh_token) {
      throw new AuthLoginFailedError(
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

  async verifyAccessToken(accessToken: string): Promise<VerifiedAccessToken | null> {
    let jwks: Jwks;
    try {
      jwks = await this.getJwks();
    } catch {
      return null;
    }

    const claims = verifyJwtSignature(accessToken, jwks);
    if (!claims) return null;

    const exp = claims.exp;
    const sub = claims.sub;
    const email = claims.email;
    // Supabase always includes `email` on a password-grant token (the only
    // grant this provider issues); requiring it here — rather than letting
    // it through as optional — keeps `VerifiedAccessToken.email` a real
    // guarantee for the login route's auto-provisioning step (ADR-0022 v1.1)
    // instead of a value callers must re-check.
    if (typeof exp !== 'number' || typeof sub !== 'string' || !sub || typeof email !== 'string' || !email) {
      return null;
    }
    if (exp * 1000 <= Date.now()) return null;

    return { subjectId: sub, email, expiresAt: new Date(exp * 1000).toISOString() };
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
