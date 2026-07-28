/** Field-name fragments that mark a value as secret-shaped — matched case-insensitively against every key, recursively, so logging a whole config/credentials object by mistake can never leak its values. */
const SECRET_KEY_FRAGMENTS = ['secret', 'token', 'password', 'credential', 'authorization', 'apikey', 'api_key', 'privatekey'];

export const REDACTED = '[REDACTED]';

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Recursively redacts any field whose key looks secret-shaped (Phase 3.1) —
 * the one thing every log call in this backend passes through before it
 * reaches stdout, so a future call site that accidentally logs a
 * credentials object or full `AppConfig` can't leak `credentialEncryptionKey`,
 * `googleOAuthClientSecret`, a stored `accessToken`, etc.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSecretKey(key) ? REDACTED : redact(fieldValue);
    }
    return result;
  }
  return value;
}
