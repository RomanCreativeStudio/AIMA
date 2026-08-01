import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { verifyJwtRs256, type Jwks } from './jwt';

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRsaKeyPairWithJwk(kid: string): { privateKeyPem: string; jwks: Jwks } {
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

test('verifyJwtRs256 returns the payload for a validly signed token', () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const token = signJwt(privateKeyPem, 'key-1', { sub: 'user-123', exp: 9999999999 });

  const claims = verifyJwtRs256(token, jwks);
  assert.deepEqual(claims, { sub: 'user-123', exp: 9999999999 });
});

test('verifyJwtRs256 returns null when the signature does not match the key', () => {
  const { jwks } = generateRsaKeyPairWithJwk('key-1');
  const other = generateRsaKeyPairWithJwk('key-1');
  const token = signJwt(other.privateKeyPem, 'key-1', { sub: 'user-123', exp: 9999999999 });

  assert.equal(verifyJwtRs256(token, jwks), null);
});

test('verifyJwtRs256 returns null for a malformed token', () => {
  const { jwks } = generateRsaKeyPairWithJwk('key-1');
  assert.equal(verifyJwtRs256('not-a-jwt', jwks), null);
  assert.equal(verifyJwtRs256('a.b', jwks), null);
});

test('verifyJwtRs256 returns null for a non-RS256 header', () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', kid: 'key-1' }));
  const payload = base64UrlEncode(JSON.stringify({ sub: 'user-123' }));
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPrivateKey(privateKeyPem));
  const token = `${header}.${payload}.${base64UrlEncode(signature)}`;

  assert.equal(verifyJwtRs256(token, jwks), null);
});

test('verifyJwtRs256 returns null when kid references an unknown key', () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const token = signJwt(privateKeyPem, 'unknown-kid', { sub: 'user-123' });

  assert.equal(verifyJwtRs256(token, jwks), null);
});
