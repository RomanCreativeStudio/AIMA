import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { verifyJwtSignature, type Jwks } from './jwt';

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

function signRs256Jwt(privateKeyPem: string, kid: string, claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const signedData = `${headerB64}.${payloadB64}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signedData), createPrivateKey(privateKeyPem));
  return `${signedData}.${base64UrlEncode(signature)}`;
}

// ES256 (EC P-256) fixtures — Supabase Auth's current default for new
// projects using its "JWT Signing Keys" feature (confirmed against a real
// live project, EPIC-004 Sprint 4.9). Node's `sign()`/`verify()` produce/
// expect DER-encoded EC signatures by default; `dsaEncoding: 'ieee-p1363'`
// switches to the raw (r || s) format JWS/JOSE actually uses on the wire.
function generateEcKeyPairWithJwk(kid: string): { privateKeyPem: string; jwks: Jwks } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { crv: string; x: string; y: string };
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    jwks: { keys: [{ kty: 'EC', kid, crv: jwk.crv, x: jwk.x, y: jwk.y, alg: 'ES256' }] },
  };
}

function signEs256Jwt(privateKeyPem: string, kid: string, claims: Record<string, unknown>): string {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const signedData = `${headerB64}.${payloadB64}`;
  const signature = cryptoSign('sha256', Buffer.from(signedData), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signedData}.${base64UrlEncode(signature)}`;
}

test('verifyJwtSignature returns the payload for a validly signed RS256 token', () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const token = signRs256Jwt(privateKeyPem, 'key-1', { sub: 'user-123', exp: 9999999999 });

  const claims = verifyJwtSignature(token, jwks);
  assert.deepEqual(claims, { sub: 'user-123', exp: 9999999999 });
});

test('verifyJwtSignature returns null when an RS256 signature does not match the key', () => {
  const { jwks } = generateRsaKeyPairWithJwk('key-1');
  const other = generateRsaKeyPairWithJwk('key-1');
  const token = signRs256Jwt(other.privateKeyPem, 'key-1', { sub: 'user-123', exp: 9999999999 });

  assert.equal(verifyJwtSignature(token, jwks), null);
});

test('verifyJwtSignature returns null for a malformed token', () => {
  const { jwks } = generateRsaKeyPairWithJwk('key-1');
  assert.equal(verifyJwtSignature('not-a-jwt', jwks), null);
  assert.equal(verifyJwtSignature('a.b', jwks), null);
});

test('verifyJwtSignature returns null for an unsupported alg', () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', kid: 'key-1' }));
  const payload = base64UrlEncode(JSON.stringify({ sub: 'user-123' }));
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPrivateKey(privateKeyPem));
  const token = `${header}.${payload}.${base64UrlEncode(signature)}`;

  assert.equal(verifyJwtSignature(token, jwks), null);
});

test('verifyJwtSignature returns null when kid references an unknown key (RS256)', () => {
  const { privateKeyPem, jwks } = generateRsaKeyPairWithJwk('key-1');
  const token = signRs256Jwt(privateKeyPem, 'unknown-kid', { sub: 'user-123' });

  assert.equal(verifyJwtSignature(token, jwks), null);
});

test('verifyJwtSignature returns the payload for a validly signed ES256 token', () => {
  const { privateKeyPem, jwks } = generateEcKeyPairWithJwk('key-1');
  const token = signEs256Jwt(privateKeyPem, 'key-1', { sub: 'user-456', exp: 9999999999 });

  const claims = verifyJwtSignature(token, jwks);
  assert.deepEqual(claims, { sub: 'user-456', exp: 9999999999 });
});

test('verifyJwtSignature returns null when an ES256 signature does not match the key', () => {
  const { jwks } = generateEcKeyPairWithJwk('key-1');
  const other = generateEcKeyPairWithJwk('key-1');
  const token = signEs256Jwt(other.privateKeyPem, 'key-1', { sub: 'user-456', exp: 9999999999 });

  assert.equal(verifyJwtSignature(token, jwks), null);
});

test('verifyJwtSignature returns null when kid references an unknown key (ES256)', () => {
  const { privateKeyPem, jwks } = generateEcKeyPairWithJwk('key-1');
  const token = signEs256Jwt(privateKeyPem, 'unknown-kid', { sub: 'user-456' });

  assert.equal(verifyJwtSignature(token, jwks), null);
});

test('verifyJwtSignature returns null for an RS256 token when only an EC key is published', () => {
  const rsa = generateRsaKeyPairWithJwk('key-1');
  const ec = generateEcKeyPairWithJwk('key-1');
  const token = signRs256Jwt(rsa.privateKeyPem, 'key-1', { sub: 'user-123', exp: 9999999999 });

  assert.equal(verifyJwtSignature(token, ec.jwks), null);
});
