import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFetch } from '../testUtils/fakeFetch';
import { OAuthExchangeFailedError } from './errors';
import { GITHUB_OAUTH_SCOPES, GitHubOAuthProvider } from './githubOAuthProvider';

function buildProvider(fetchFn: typeof fetch) {
  return new GitHubOAuthProvider('client-id', 'client-secret', 'https://backend.example/api/oauth/github/callback', fetchFn);
}

test('getAuthorizationUrl builds a GitHub authorization URL with the repo scope and given state', () => {
  const { fetchFn } = createFakeFetch([]);
  const provider = buildProvider(fetchFn);

  const url = new URL(provider.getAuthorizationUrl('the-state'));

  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://backend.example/api/oauth/github/callback');
  assert.equal(url.searchParams.get('scope'), GITHUB_OAUTH_SCOPES.join(' '));
  assert.equal(url.searchParams.get('state'), 'the-state');
});

test('exchangeCode returns a non-expiring token set when GitHub omits refresh_token/expires_in (classic OAuth App)', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { access_token: 'gho_abc123', scope: 'repo' } }]);
  const provider = buildProvider(fetchFn);

  const tokens = await provider.exchangeCode('the-code');

  assert.equal(tokens.accessToken, 'gho_abc123');
  assert.equal(tokens.refreshToken, null);
  assert.equal(tokens.expiresAt, null);
  assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
});

test('exchangeCode returns a full token set when the app has opted into expiring tokens', async () => {
  const { fetchFn } = createFakeFetch([{ status: 200, body: { access_token: 'gho_abc123', refresh_token: 'ghr_xyz', expires_in: 28800 } }]);
  const provider = buildProvider(fetchFn);

  const tokens = await provider.exchangeCode('the-code');

  assert.equal(tokens.refreshToken, 'ghr_xyz');
  assert.ok(tokens.expiresAt);
});

test('exchangeCode throws OAuthExchangeFailedError when GitHub reports an error or omits access_token', async () => {
  const { fetchFn } = createFakeFetch([{ status: 200, body: { error: 'bad_verification_code', error_description: 'The code passed is incorrect.' } }]);
  const provider = buildProvider(fetchFn);

  await assert.rejects(() => provider.exchangeCode('bad-code'), OAuthExchangeFailedError);
});

test('revokeToken sends a DELETE with Basic auth to the app grant endpoint', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 204 }]);
  const provider = buildProvider(fetchFn);

  await provider.revokeToken('gho_abc123');

  assert.equal(calls[0].url, 'https://api.github.com/applications/client-id/grant');
  assert.equal(calls[0].init?.method, 'DELETE');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.match(headers.Authorization, /^Basic /);
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), { access_token: 'gho_abc123' });
});
