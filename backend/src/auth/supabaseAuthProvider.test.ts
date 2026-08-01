import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createFakeFetch } from '../testUtils/fakeFetch';
import { AuthLoginFailedError, AuthRefreshFailedError } from './errors';
import { SupabaseAuthProvider } from './supabaseAuthProvider';

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRsaKeyPairWithJwk(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    jwks: { keys: [{ kty: 'RSA', kid, n: jwk.n, e: jwk.e, alg: 'RS256' }] },
  };
}

function signJwt(privateKeyPem: string, kid: string, claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const signedData = `${headerB64}.${payloadB64}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signedData), createPrivateKey(privateKeyPem));
  return `${signedData}.${base64UrlEncode(signature)}`;
}

test('signInWithPassword returns a token pair on success', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } },
  ]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  const tokens = await provider.signInWithPassword('user@example.com', 'correct-password');

  assert.equal(tokens.accessToken, 'new-access');
  assert.equal(tokens.refreshToken, 'new-refresh');
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=password$/);
});

test('signInWithPassword throws AuthLoginFailedError when Supabase rejects the credentials', async () => {
  const { fetchFn } = createFakeFetch([
    { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } },
  ]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  await assert.rejects(
    () => provider.signInWithPassword('user@example.com', 'wrong-password'),
    AuthLoginFailedError,
  );
});

test('verifyAccessToken accepts a validly signed, unexpired token', async () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const token = signJwt(privateKeyPem, 'key-1', { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 });
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: jwks }]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  const verified = await provider.verifyAccessToken(token);

  assert.equal(verified?.subjectId, 'user-123');
  assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/.well-known/jwks.json');
});

test('verifyAccessToken rejects an invalid signature', async () => {
  const { jwks } = generateRsaKeyPairWithJwk('key-1');
  const other = generateRsaKeyPairWithJwk('key-1');
  const token = signJwt(other.privateKeyPem, 'key-1', { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 });
  const { fetchFn } = createFakeFetch([{ status: 200, body: jwks }]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  assert.equal(await provider.verifyAccessToken(token), null);
});

test('verifyAccessToken rejects an expired token', async () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const token = signJwt(privateKeyPem, 'key-1', { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 60 });
  const { fetchFn } = createFakeFetch([{ status: 200, body: jwks }]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  assert.equal(await provider.verifyAccessToken(token), null);
});

test('refreshSession returns a new token pair on success', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } },
  ]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  const tokens = await provider.refreshSession('old-refresh');

  assert.equal(tokens.accessToken, 'new-access');
  assert.equal(tokens.refreshToken, 'new-refresh');
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
});

test('refreshSession throws AuthRefreshFailedError when Supabase rejects the token', async () => {
  const { fetchFn } = createFakeFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid Refresh Token' } }]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  await assert.rejects(() => provider.refreshSession('bad-refresh'), AuthRefreshFailedError);
});

test('revokeSession swallows a failed logout call (local revocation is authoritative)', async () => {
  const { fetchFn } = createFakeFetch([{ status: 500, body: { error: 'server_error' } }]);
  const provider = new SupabaseAuthProvider('https://project.supabase.co', 'anon-key', fetchFn);

  await assert.doesNotReject(() => provider.revokeSession('some-access-token'));
});
