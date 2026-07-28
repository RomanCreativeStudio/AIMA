export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
  databaseUrl: string;
  /** Whether to negotiate TLS with Postgres (Phase 3.1) — most managed providers (Supabase, Render, Fly Postgres) need this in production; `rejectUnauthorized: false` since these providers commonly present a certificate not chained to a public CA. */
  databaseSsl: boolean;
  /** Max simultaneous connections in the pool (Phase 3.1) — bounded so a traffic spike can't exhaust the database's own connection limit. */
  databasePoolMax: number;
  corsOrigins: string[];
  /** Base64-encoded 32-byte AES-256 key backing `AesGcmCredentialEncryptor` (Phase 2.3). Generate with `openssl rand -base64 32`. */
  credentialEncryptionKey: string;
  /** This process's own publicly reachable base URL (Phase 2.7) — used to build the fixed OAuth redirect_uri (`{publicBackendUrl}/api/oauth/:provider/callback`) registered with each provider's OAuth app. */
  publicBackendUrl: string;
  /** Google OAuth app credentials (Phase 2.7) — one app covers both `gmail` and `calendar`, since both are Google APIs; register at https://console.cloud.google.com/apis/credentials. */
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  /** GitHub OAuth app credentials (Phase 2.7) — register at https://github.com/settings/developers. */
  githubOAuthClientId: string;
  githubOAuthClientSecret: string;
}

/**
 * Loads and validates process.env into a typed config object. Fails fast at
 * startup rather than letting a missing variable surface as a confusing
 * runtime error later (docs/DEVELOPMENT_SETUP.md §5). Phase 3.1 adds
 * production-only checks (docs/decisions/0016-production-deployment-
 * foundation.md) — these never require real external credentials, only
 * that the *shape* of what's already required is production-safe (e.g. a
 * real TLS callback URL, not `http://localhost`).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = validateNodeEnv(env.NODE_ENV);

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy backend/.env.example to backend/.env and configure it ' +
        '(see docs/DEVELOPMENT_SETUP.md §5).',
    );
  }

  const credentialEncryptionKey = env.CREDENTIAL_ENCRYPTION_KEY;
  if (!credentialEncryptionKey) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is required (Phase 2.3 integration credentials are encrypted at rest). ' +
        'Generate one with `openssl rand -base64 32` and copy backend/.env.example to backend/.env.',
    );
  }
  if (Buffer.from(credentialEncryptionKey, 'base64').length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${Buffer.from(credentialEncryptionKey, 'base64').length}). ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }

  const publicBackendUrl = env.PUBLIC_BACKEND_URL;
  if (!publicBackendUrl) {
    throw new Error(
      'PUBLIC_BACKEND_URL is required (Phase 2.7 OAuth flows redirect back to this process). ' +
        'Set it to this backend\'s own reachable URL, e.g. http://127.0.0.1:4000 for local development.',
    );
  }
  if (nodeEnv === 'production' && !publicBackendUrl.startsWith('https://')) {
    throw new Error(
      `PUBLIC_BACKEND_URL must be an https:// URL in production (got "${publicBackendUrl}") — OAuth providers ` +
        'redirect real users here, and a plaintext callback would leak authorization codes in transit.',
    );
  }

  const googleOAuthClientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const googleOAuthClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!googleOAuthClientId || !googleOAuthClientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required (Phase 2.7 Gmail/Calendar OAuth). ' +
        'Register an OAuth app at https://console.cloud.google.com/apis/credentials.',
    );
  }

  const githubOAuthClientId = env.GITHUB_OAUTH_CLIENT_ID;
  const githubOAuthClientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!githubOAuthClientId || !githubOAuthClientSecret) {
    throw new Error(
      'GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are required (Phase 2.7 GitHub OAuth). ' +
        'Register an OAuth app at https://github.com/settings/developers.',
    );
  }

  return {
    port: Number(env.PORT ?? 4000),
    nodeEnv,
    databaseUrl,
    databaseSsl: env.DATABASE_SSL === 'true',
    databasePoolMax: Number(env.DATABASE_POOL_MAX ?? 10),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentialEncryptionKey,
    publicBackendUrl,
    googleOAuthClientId,
    googleOAuthClientSecret,
    githubOAuthClientId,
    githubOAuthClientSecret,
  };
}

function validateNodeEnv(value: string | undefined): NodeEnv {
  const candidate = value ?? 'development';
  if (!(NODE_ENVS as readonly string[]).includes(candidate)) {
    throw new Error(`NODE_ENV must be one of ${NODE_ENVS.join('/')} (got "${candidate}").`);
  }
  return candidate as NodeEnv;
}
