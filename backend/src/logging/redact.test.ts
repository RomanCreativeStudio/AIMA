import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, REDACTED } from './redact';

test('redact() replaces values whose key names look secret-shaped', () => {
  const result = redact({
    accessToken: 'abc123',
    refreshToken: 'def456',
    password: 'hunter2',
    apiKey: 'key-1',
    api_key: 'key-2',
    credentialEncryptionKey: 'k',
    Authorization: 'Bearer xyz',
    privateKey: 'pem-data',
  });

  assert.deepEqual(result, {
    accessToken: REDACTED,
    refreshToken: REDACTED,
    password: REDACTED,
    apiKey: REDACTED,
    api_key: REDACTED,
    credentialEncryptionKey: REDACTED,
    Authorization: REDACTED,
    privateKey: REDACTED,
  });
});

test('redact() leaves non-secret-shaped keys untouched', () => {
  const result = redact({ userId: 'u1', method: 'GET', statusCode: 200 });
  assert.deepEqual(result, { userId: 'u1', method: 'GET', statusCode: 200 });
});

test('redact() recurses into nested objects and arrays', () => {
  const result = redact({
    context: { nested: { token: 'secret' }, safe: 'ok' },
    items: [{ password: 'x' }, { name: 'y' }],
  });

  assert.deepEqual(result, {
    context: { nested: { token: REDACTED }, safe: 'ok' },
    items: [{ password: REDACTED }, { name: 'y' }],
  });
});

test('redact() passes through primitives and null unchanged', () => {
  assert.equal(redact('hello'), 'hello');
  assert.equal(redact(42), 42);
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
});
