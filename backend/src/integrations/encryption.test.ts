import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { AesGcmCredentialEncryptor } from './encryption';

const TEST_KEY = randomBytes(32).toString('base64');

test('encrypt/decrypt round-trips the original plaintext', () => {
  const encryptor = new AesGcmCredentialEncryptor(TEST_KEY);
  const plaintext = JSON.stringify({ accessToken: 'abc123', refreshToken: 'def456' });

  const payload = encryptor.encrypt(plaintext);
  const decrypted = encryptor.decrypt(payload);

  assert.equal(decrypted, plaintext);
});

test('encrypt never reuses an IV across calls', () => {
  const encryptor = new AesGcmCredentialEncryptor(TEST_KEY);
  const first = encryptor.encrypt('same plaintext');
  const second = encryptor.encrypt('same plaintext');

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext, 'a fresh IV should produce different ciphertext even for identical plaintext');
});

test('decrypt fails if the ciphertext has been tampered with', () => {
  const encryptor = new AesGcmCredentialEncryptor(TEST_KEY);
  const payload = encryptor.encrypt('sensitive value');

  const tamperedByte = Buffer.from(payload.ciphertext, 'base64');
  tamperedByte[0] ^= 0xff;
  const tampered = { ...payload, ciphertext: tamperedByte.toString('base64') };

  assert.throws(() => encryptor.decrypt(tampered));
});

test('decrypt fails with the wrong key', () => {
  const encryptor = new AesGcmCredentialEncryptor(TEST_KEY);
  const payload = encryptor.encrypt('sensitive value');

  const wrongKeyEncryptor = new AesGcmCredentialEncryptor(randomBytes(32).toString('base64'));
  assert.throws(() => wrongKeyEncryptor.decrypt(payload));
});

test('constructor rejects a key that does not decode to exactly 32 bytes', () => {
  assert.throws(() => new AesGcmCredentialEncryptor(randomBytes(16).toString('base64')), /32 bytes/);
  assert.throws(() => new AesGcmCredentialEncryptor(randomBytes(64).toString('base64')), /32 bytes/);
});
