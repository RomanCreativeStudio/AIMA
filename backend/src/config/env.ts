export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  corsOrigins: string[];
  /** Base64-encoded 32-byte AES-256 key backing `AesGcmCredentialEncryptor` (Phase 2.3). Generate with `openssl rand -base64 32`. */
  credentialEncryptionKey: string;
}

/**
 * Loads and validates process.env into a typed config object. Fails fast at
 * startup rather than letting a missing variable surface as a confusing
 * runtime error later (docs/DEVELOPMENT_SETUP.md §5).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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

  return {
    port: Number(env.PORT ?? 4000),
    nodeEnv: env.NODE_ENV ?? 'development',
    databaseUrl,
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentialEncryptionKey,
  };
}
