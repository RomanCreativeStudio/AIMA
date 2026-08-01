import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
}

export interface Jwks {
  keys: Jwk[];
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

/**
 * Verifies an RS256-signed JWT's signature against a JWKS key set and
 * returns its decoded payload claims, or `null` if the token is malformed,
 * uses an algorithm other than RS256, references an unknown key, or fails
 * signature verification. Does not check `exp`/`nbf` — callers check
 * expiry themselves (ADR-0022 Decision 2's caller-side expiry check).
 *
 * Standard JWT/JWK/JWS mechanics (RFC 7515/7517/7519) implemented directly
 * against Node's built-in `crypto` — not provider-specific, and not an
 * assumption about any particular vendor's token internals beyond "RS256,
 * verified via a published JWKS," which is how `SupabaseAuthProvider`
 * (and any standards-compliant OIDC-style provider) issues tokens.
 */
export function verifyJwtRs256(token: string, jwks: Jwks): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256') return null;

  const jwk = jwks.keys.find((key) => key.kty === 'RSA' && (!header.kid || key.kid === header.kid));
  if (!jwk || !jwk.n || !jwk.e) return null;

  let publicKey;
  try {
    publicKey = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch {
    return null;
  }

  const signedData = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = base64UrlDecode(signatureB64);

  let isValid: boolean;
  try {
    isValid = cryptoVerify('RSA-SHA256', signedData, publicKey, signature);
  } catch {
    return null;
  }

  return isValid ? payload : null;
}
