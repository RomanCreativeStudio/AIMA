import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAuthProvider } from './supabaseAuthProvider';

/**
 * Live-provider verification (EPIC-004 Sprint 4.9) — the same class every
 * other test in this file exercises against a fake HTTP layer, run here
 * against a real Supabase project instead. Opt-in only: skips cleanly
 * (not a failure) unless all four `LIVE_SUPABASE_*` env vars are set, so
 * `npm test` stays hermetic and network-free by default in local dev and
 * CI alike. This is exactly the gap `RISK-001`'s Sprint 4.5 entry left
 * open — every other test here proves the code is internally consistent
 * with itself; this proves it against the actual vendor.
 *
 * To run: set `LIVE_SUPABASE_AUTH_URL` (the project URL), `LIVE_SUPABASE_AUTH_API_KEY`
 * (its anon/publishable key), `LIVE_SUPABASE_TEST_EMAIL`/`LIVE_SUPABASE_TEST_PASSWORD`
 * (a real, confirmed user in that project), then `npm test` as usual.
 */
const LIVE_URL = process.env.LIVE_SUPABASE_AUTH_URL;
const LIVE_API_KEY = process.env.LIVE_SUPABASE_AUTH_API_KEY;
const LIVE_EMAIL = process.env.LIVE_SUPABASE_TEST_EMAIL;
const LIVE_PASSWORD = process.env.LIVE_SUPABASE_TEST_PASSWORD;

const skip =
  !LIVE_URL || !LIVE_API_KEY || !LIVE_EMAIL || !LIVE_PASSWORD
    ? 'set LIVE_SUPABASE_AUTH_URL, LIVE_SUPABASE_AUTH_API_KEY, LIVE_SUPABASE_TEST_EMAIL, and LIVE_SUPABASE_TEST_PASSWORD to run this against a real Supabase project'
    : false;

test('SupabaseAuthProvider: login, verify, refresh, and revoke against a real project', { skip }, async () => {
  const provider = new SupabaseAuthProvider(LIVE_URL!, LIVE_API_KEY!);

  const tokens = await provider.signInWithPassword(LIVE_EMAIL!, LIVE_PASSWORD!);
  assert.ok(tokens.accessToken.length > 0);
  assert.ok(tokens.refreshToken.length > 0);

  // Proves verifyJwtSignature (backend/src/auth/jwt.ts) actually accepts
  // whichever algorithm this real project signs with — RS256 or ES256 —
  // not just whichever one a hand-built test fixture chooses.
  const verified = await provider.verifyAccessToken(tokens.accessToken);
  assert.ok(verified, 'a freshly issued access token must verify against the project\'s own published JWKS');
  assert.ok(verified!.subjectId.length > 0);
  assert.equal(verified!.email, LIVE_EMAIL);
  assert.ok(new Date(verified!.expiresAt).getTime() > Date.now());

  const refreshed = await provider.refreshSession(tokens.refreshToken);
  assert.ok(refreshed.accessToken.length > 0);
  assert.notEqual(refreshed.refreshToken, tokens.refreshToken, 'Supabase rotates the refresh token on every use');

  const reVerified = await provider.verifyAccessToken(refreshed.accessToken);
  assert.equal(reVerified!.subjectId, verified!.subjectId);

  // Best-effort per SupabaseAuthProvider's documented contract — asserting
  // only that it doesn't throw, since local revocation (auth_sessions) is
  // authoritative, not this call's outcome (ADR-0022 Decision 3).
  await provider.revokeSession(refreshed.refreshToken);
});
