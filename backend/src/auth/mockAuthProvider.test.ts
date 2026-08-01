import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAuthProvider, issueMockTokens } from './mockAuthProvider';
import { AuthRefreshFailedError } from './errors';

test('verifyAccessToken accepts a freshly issued token', async () => {
  const provider = new MockAuthProvider();
  const tokens = issueMockTokens('user-123');

  const verified = await provider.verifyAccessToken(tokens.accessToken);
  assert.deepEqual(verified, { subjectId: 'user-123', expiresAt: tokens.accessTokenExpiresAt });
});

test('verifyAccessToken rejects an invalid token', async () => {
  const provider = new MockAuthProvider();
  assert.equal(await provider.verifyAccessToken('not-a-real-token'), null);
});

test('verifyAccessToken rejects an expired token', async () => {
  const provider = new MockAuthProvider();
  const tokens = issueMockTokens('user-123', -1000);

  assert.equal(await provider.verifyAccessToken(tokens.accessToken), null);
});

test('refreshSession issues a new token pair for a valid refresh token', async () => {
  const provider = new MockAuthProvider();
  const tokens = issueMockTokens('user-123');

  const refreshed = await provider.refreshSession(tokens.refreshToken);
  assert.notEqual(refreshed.refreshToken, tokens.refreshToken);

  const verified = await provider.verifyAccessToken(refreshed.accessToken);
  assert.equal(verified?.subjectId, 'user-123');
});

test('refreshSession rejects an unrecognized refresh token', async () => {
  const provider = new MockAuthProvider();
  await assert.rejects(() => provider.refreshSession('garbage'), AuthRefreshFailedError);
});

test('revokeSession resolves without error (no provider-side state)', async () => {
  const provider = new MockAuthProvider();
  await assert.doesNotReject(() => provider.revokeSession('mock-access:user-123:2999-01-01T00:00:00.000Z'));
});
