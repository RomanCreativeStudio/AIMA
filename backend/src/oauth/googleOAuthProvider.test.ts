import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFetch } from '../testUtils/fakeFetch';
import { OAuthExchangeFailedError } from './errors';
import { GOOGLE_OAUTH_SCOPES, GoogleOAuthProvider } from './googleOAuthProvider';

function buildProvider(fetchFn: typeof fetch) {
  return new GoogleOAuthProvider('gmail', 'client-id', 'client-secret', 'https://backend.example/api/oauth/gmail/callback', GOOGLE_OAUTH_SCOPES.gmail, fetchFn);
}

test('getAuthorizationUrl builds a Google authorization URL with offline access and the given state', () => {
  const { fetchFn } = createFakeFetch([]);
  const provider = buildProvider(fetchFn);

  const url = new URL(provider.getAuthorizationUrl('the-state'));

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://backend.example/api/oauth/gmail/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'the-state');
  assert.equal(url.searchParams.get('scope'), GOOGLE_OAUTH_SCOPES.gmail.join(' '));
});

test('exchangeCode posts to the token endpoint and returns a token set with a computed expiry', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'gmail.send' } },
  ]);
  const provider = buildProvider(fetchFn);

  const before = Date.now();
  const tokens = await provider.exchangeCode('the-code');

  assert.equal(tokens.accessToken, 'access-1');
  assert.equal(tokens.refreshToken, 'refresh-1');
  assert.ok(tokens.expiresAt);
  assert.ok(new Date(tokens.expiresAt!).getTime() > before);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  const sentBody = new URLSearchParams(calls[0].init?.body as string);
  assert.equal(sentBody.get('grant_type'), 'authorization_code');
  assert.equal(sentBody.get('code'), 'the-code');
  assert.equal(sentBody.get('client_secret'), 'client-secret');
});

test('exchangeCode throws OAuthExchangeFailedError when Google reports an error', async () => {
  const { fetchFn } = createFakeFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Code already used.' } }]);
  const provider = buildProvider(fetchFn);

  await assert.rejects(() => provider.exchangeCode('stale-code'), OAuthExchangeFailedError);
});

test('refreshAccessToken preserves the original refresh token when Google omits one from the response', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { access_token: 'access-2', expires_in: 3600 } }]);
  const provider = buildProvider(fetchFn);

  const refreshed = await provider.refreshAccessToken('refresh-1');

  assert.equal(refreshed.accessToken, 'access-2');
  assert.equal(refreshed.refreshToken, 'refresh-1', 'the original refresh token must be preserved when Google omits one');
  const sentBody = new URLSearchParams(calls[0].init?.body as string);
  assert.equal(sentBody.get('grant_type'), 'refresh_token');
  assert.equal(sentBody.get('refresh_token'), 'refresh-1');
});

test('revokeToken posts to the revoke endpoint with the access token', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200 }]);
  const provider = buildProvider(fetchFn);

  await provider.revokeToken('access-1');

  assert.match(calls[0].url, /^https:\/\/oauth2\.googleapis\.com\/revoke\?token=access-1$/);
  assert.equal(calls[0].init?.method, 'POST');
});
