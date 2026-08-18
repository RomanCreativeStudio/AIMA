import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './env';

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/aima',
    CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
    PUBLIC_BACKEND_URL: 'http://127.0.0.1:4000',
    GOOGLE_OAUTH_CLIENT_ID: 'google-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    GITHUB_OAUTH_CLIENT_ID: 'github-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'github-secret',
    ...overrides,
  };
}

test('loadConfig() returns a valid config for a fully-populated development environment', () => {
  const config = loadConfig(validEnv());

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.databaseSsl, false);
  assert.equal(config.databasePoolMax, 10);
});

test('loadConfig() defaults NODE_ENV to "development" when unset', () => {
  const config = loadConfig(validEnv());
  assert.equal(config.nodeEnv, 'development');
});

test('loadConfig() rejects an unrecognized NODE_ENV', () => {
  assert.throws(() => loadConfig(validEnv({ NODE_ENV: 'staging' })), /NODE_ENV must be one of/);
});

test('loadConfig() accepts "test" and "production" as valid NODE_ENV values', () => {
  assert.equal(loadConfig(validEnv({ NODE_ENV: 'test' })).nodeEnv, 'test');
  assert.equal(
    loadConfig(
      validEnv({ NODE_ENV: 'production', PUBLIC_BACKEND_URL: 'https://api.example.com', AUTH_PROVIDER: 'supabase' }),
    ).nodeEnv,
    'production',
  );
});

test('loadConfig() throws when DATABASE_URL is missing', () => {
  const env = validEnv();
  delete env.DATABASE_URL;
  assert.throws(() => loadConfig(env), /DATABASE_URL is required/);
});

test('loadConfig() throws when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
  const env = validEnv();
  delete env.CREDENTIAL_ENCRYPTION_KEY;
  assert.throws(() => loadConfig(env), /CREDENTIAL_ENCRYPTION_KEY is required/);
});

test('loadConfig() throws when CREDENTIAL_ENCRYPTION_KEY does not decode to 32 bytes', () => {
  assert.throws(
    () => loadConfig(validEnv({ CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })),
    /must decode to exactly 32 bytes/,
  );
});

test('loadConfig() throws when PUBLIC_BACKEND_URL is missing', () => {
  const env = validEnv();
  delete env.PUBLIC_BACKEND_URL;
  assert.throws(() => loadConfig(env), /PUBLIC_BACKEND_URL is required/);
});

test('loadConfig() requires an https:// PUBLIC_BACKEND_URL in production', () => {
  assert.throws(
    () =>
      loadConfig(
        validEnv({ NODE_ENV: 'production', PUBLIC_BACKEND_URL: 'http://api.example.com', AUTH_PROVIDER: 'supabase' }),
      ),
    /must be an https:\/\/ URL in production/,
  );
});

test('loadConfig() allows an http:// PUBLIC_BACKEND_URL outside production', () => {
  const config = loadConfig(validEnv({ PUBLIC_BACKEND_URL: 'http://127.0.0.1:4000' }));
  assert.equal(config.publicBackendUrl, 'http://127.0.0.1:4000');
});

test('loadConfig() accepts an https:// PUBLIC_BACKEND_URL in production', () => {
  const config = loadConfig(
    validEnv({ NODE_ENV: 'production', PUBLIC_BACKEND_URL: 'https://api.example.com', AUTH_PROVIDER: 'supabase' }),
  );
  assert.equal(config.publicBackendUrl, 'https://api.example.com');
});

test('loadConfig() throws when AUTH_PROVIDER is unset in production (defaults to mock)', () => {
  const env = validEnv({ NODE_ENV: 'production', PUBLIC_BACKEND_URL: 'https://api.example.com' });
  delete env.AUTH_PROVIDER;
  assert.throws(() => loadConfig(env), /AUTH_PROVIDER must not be "mock" in production/);
});

test('loadConfig() throws when AUTH_PROVIDER is explicitly "mock" in production', () => {
  assert.throws(
    () =>
      loadConfig(
        validEnv({ NODE_ENV: 'production', PUBLIC_BACKEND_URL: 'https://api.example.com', AUTH_PROVIDER: 'mock' }),
      ),
    /AUTH_PROVIDER must not be "mock" in production/,
  );
});

test('loadConfig() allows AUTH_PROVIDER=supabase in production', () => {
  const config = loadConfig(
    validEnv({ NODE_ENV: 'production', PUBLIC_BACKEND_URL: 'https://api.example.com', AUTH_PROVIDER: 'supabase' }),
  );
  assert.equal(config.nodeEnv, 'production');
});

test('loadConfig() allows AUTH_PROVIDER unset (mock) outside production', () => {
  const config = loadConfig(validEnv());
  assert.equal(config.nodeEnv, 'development');
});

test('loadConfig() throws when Google OAuth credentials are missing', () => {
  const env = validEnv();
  delete env.GOOGLE_OAUTH_CLIENT_ID;
  assert.throws(() => loadConfig(env), /GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required/);
});

test('loadConfig() throws when GitHub OAuth credentials are missing', () => {
  const env = validEnv();
  delete env.GITHUB_OAUTH_CLIENT_SECRET;
  assert.throws(() => loadConfig(env), /GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are required/);
});

test('loadConfig() parses DATABASE_SSL and DATABASE_POOL_MAX', () => {
  const config = loadConfig(validEnv({ DATABASE_SSL: 'true', DATABASE_POOL_MAX: '25' }));
  assert.equal(config.databaseSsl, true);
  assert.equal(config.databasePoolMax, 25);
});

test('loadConfig() splits and trims CORS_ORIGINS, dropping empty entries', () => {
  const config = loadConfig(validEnv({ CORS_ORIGINS: 'https://a.example.com, https://b.example.com,' }));
  assert.deepEqual(config.corsOrigins, ['https://a.example.com', 'https://b.example.com']);
});

test('loadConfig() defaults CORS_ORIGINS to an empty array when unset', () => {
  const config = loadConfig(validEnv());
  assert.deepEqual(config.corsOrigins, []);
});
