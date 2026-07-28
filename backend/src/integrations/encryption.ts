import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The three pieces an AES-GCM ciphertext needs to be decrypted later — all base64, all stored alongside each other in `integration_credentials`. */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * The credential layer's encrypted-storage abstraction (Phase 2.3, item 3) —
 * a provider interface (like `AIProvider`/`EmbeddingProvider` in `ai-engine`)
 * so `IntegrationService` never depends on a specific cipher directly.
 */
export interface CredentialEncryptor {
  encrypt(plaintext: string): EncryptedPayload;
  decrypt(payload: EncryptedPayload): string;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

/**
 * The real `CredentialEncryptor` — AES-256-GCM via Node's built-in `crypto`
 * (no third-party dependency needed for this, per the "avoid unnecessary
 * complexity" rule, docs/DEVELOPMENT_SETUP.md §9). The key comes from
 * `CREDENTIAL_ENCRYPTION_KEY` (backend/src/config/env.ts) — generate one
 * with `openssl rand -base64 32`. A fresh random IV is used per encryption
 * call, never reused, which is what makes AES-GCM safe to use here.
 */
export class AesGcmCredentialEncryptor implements CredentialEncryptor {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}). ` +
          'Generate one with `openssl rand -base64 32`.',
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  }
}
