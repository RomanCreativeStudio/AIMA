import { randomUUID } from 'node:crypto';
import { AuthRefreshFailedError } from './errors';
import type { AuthProvider, IssuedTokens, VerifiedAccessToken } from './types';

const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const MOCK_ACCESS_PREFIX = 'mock-access';
const MOCK_REFRESH_PREFIX = 'mock-refresh';

/**
 * Issues a deterministic-shape mock token pair with no crypto and no
 * network call — the same "encode plain text as the payload" approach
 * `MockSpeechToTextProvider` uses. The access token encodes expiry as an
 * epoch-millisecond integer (not an ISO string) because the token format
 * itself is colon-delimited and an ISO timestamp contains colons. The
 * refresh token includes a random component so each issuance/rotation
 * produces a distinct value, matching ADR-0022 Decision 2's refresh-token
 * rotation contract.
 */
export function issueMockTokens(subjectId: string, ttlMs: number = DEFAULT_ACCESS_TOKEN_TTL_MS): IssuedTokens {
  const expiresAtMs = Date.now() + ttlMs;
  return {
    accessToken: `${MOCK_ACCESS_PREFIX}:${subjectId}:${expiresAtMs}`,
    refreshToken: `${MOCK_REFRESH_PREFIX}:${subjectId}:${randomUUID()}`,
    accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Local-development/test double for `AuthProvider` — no vendor account, no
 * network call, deterministic. Selected via `AUTH_PROVIDER=mock` (the
 * default), mirroring `MockSpeechToTextProvider`/`MockEmbeddingProvider`'s
 * role in this codebase: every existing test that needs an `AuthProvider`
 * uses this, never a live Supabase project.
 */
export class MockAuthProvider implements AuthProvider {
  async verifyAccessToken(accessToken: string): Promise<VerifiedAccessToken | null> {
    const parts = accessToken.split(':');
    if (parts.length !== 3 || parts[0] !== MOCK_ACCESS_PREFIX) return null;

    const [, subjectId, expiresAtMsRaw] = parts;
    const expiresAtMs = Number(expiresAtMsRaw);
    if (!subjectId || Number.isNaN(expiresAtMs)) return null;
    if (expiresAtMs <= Date.now()) return null;

    return { subjectId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async refreshSession(refreshToken: string): Promise<IssuedTokens> {
    const parts = refreshToken.split(':');
    if (parts.length !== 3 || parts[0] !== MOCK_REFRESH_PREFIX || !parts[1]) {
      throw new AuthRefreshFailedError('mock', 'unrecognized refresh token');
    }
    return issueMockTokens(parts[1]);
  }

  async revokeSession(): Promise<void> {
    // No provider-side state to revoke — matches MockSpeechToTextProvider/
    // MockEmbeddingProvider's "no network call" contract.
  }
}
