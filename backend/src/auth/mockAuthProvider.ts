import { createHash, randomUUID } from 'node:crypto';
import { AuthLoginFailedError, AuthRefreshFailedError } from './errors';
import type { AuthProvider, IssuedTokens, VerifiedAccessToken } from './types';

const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const MOCK_ACCESS_PREFIX = 'mock-access';
const MOCK_REFRESH_PREFIX = 'mock-refresh';

/**
 * Deterministic subject id for `email` under the mock provider, formatted
 * as a UUID so it satisfies `auth_sessions.user_id`'s FK into `users(id)`
 * once a matching row is seeded with this same id — the mock-context
 * equivalent of ADR-0022 Decision 4's "provider subject id reconciled
 * with users.id" rollout step.
 */
export function mockSubjectIdFor(email: string): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * The deterministic "correct password" for `email` under the mock
 * provider. The mock has no real credential store to check a password
 * against, so this hash-of-email stands in for one — it lets tests
 * exercise a genuine right/wrong-password path through `signInWithPassword`
 * without a database. Never a real security mechanism; mock/test use only.
 */
export function mockPasswordFor(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * The placeholder email a mock token carries when no real one is supplied
 * (e.g. `authHeader(userId)`-style tokens minted directly for a route test
 * that never goes through `signInWithPassword`). Deterministic so repeated
 * calls for the same subject stay consistent; never seen by real
 * provisioning logic, since only tokens `signInWithPassword` issues (which
 * always pass the real email) flow through the login route.
 */
function mockEmailFor(subjectId: string): string {
  return `${subjectId}@mock.aima.local`;
}

/**
 * Issues a deterministic-shape mock token pair with no crypto and no
 * network call — the same "encode plain text as the payload" approach
 * `MockSpeechToTextProvider` uses. The access token encodes expiry as an
 * epoch-millisecond integer (not an ISO string) because the token format
 * itself is colon-delimited and an ISO timestamp contains colons; `email`
 * is appended as the final segment (ADR-0022 v1.1) so `verifyAccessToken`
 * can return it without a second lookup, mirroring what a real Supabase JWT
 * already carries in its own claims. The refresh token includes a random
 * component so each issuance/rotation produces a distinct value, matching
 * ADR-0022 Decision 2's refresh-token rotation contract.
 */
export function issueMockTokens(
  subjectId: string,
  ttlMs: number = DEFAULT_ACCESS_TOKEN_TTL_MS,
  email: string = mockEmailFor(subjectId),
): IssuedTokens {
  const expiresAtMs = Date.now() + ttlMs;
  return {
    accessToken: `${MOCK_ACCESS_PREFIX}:${subjectId}:${expiresAtMs}:${email}`,
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
  async signInWithPassword(email: string, password: string): Promise<IssuedTokens> {
    if (!email || password !== mockPasswordFor(email)) {
      throw new AuthLoginFailedError('mock', 'invalid email or password');
    }
    return issueMockTokens(mockSubjectIdFor(email), undefined, email);
  }

  async verifyAccessToken(accessToken: string): Promise<VerifiedAccessToken | null> {
    const parts = accessToken.split(':');
    if (parts.length < 4 || parts[0] !== MOCK_ACCESS_PREFIX) return null;

    const [, subjectId, expiresAtMsRaw, ...emailParts] = parts;
    const email = emailParts.join(':');
    const expiresAtMs = Number(expiresAtMsRaw);
    if (!subjectId || !email || Number.isNaN(expiresAtMs)) return null;
    if (expiresAtMs <= Date.now()) return null;

    return { subjectId, email, expiresAt: new Date(expiresAtMs).toISOString() };
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
