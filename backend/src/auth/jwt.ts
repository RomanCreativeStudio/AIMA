import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
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
 * The two JWS algorithms this verifier accepts, and the JWK key type each
 * one signs with. Supabase Auth (GoTrue) issues RS256 (RSA) on older/
 * legacy-configured projects and ES256 (EC P-256) on current projects using
 * its "JWT Signing Keys" asymmetric-key feature — confirmed against a real
 * live project during EPIC-004 Sprint 4.9's live verification, whose
 * published JWKS returned an EC/P-256 key and whose issued access tokens'
 * header read `{"alg":"ES256",...}`. RS256-only support (this function's
 * original shape) verified `null` for every one of those tokens — a real
 * gap, not a hypothetical, since it was never exercised against an actual
 * Supabase project before that sprint. Both are supported here so the
 * verifier works regardless of which signing-key mode a given Supabase
 * project (or any other standards-compliant JWKS-publishing provider) uses.
 */
const KTY_BY_ALG: Record<string, string> = { RS256: 'RSA', ES256: 'EC' };

/**
 * Verifies a JWT's signature against a JWKS key set and returns its decoded
 * payload claims, or `null` if the token is malformed, uses an unsupported
 * algorithm, references an unknown key, or fails signature verification.
 * Does not check `exp`/`nbf` — callers check expiry themselves (ADR-0022
 * Decision 2's caller-side expiry check).
 *
 * Standard JWT/JWK/JWS mechanics (RFC 7515/7517/7519) implemented directly
 * against Node's built-in `crypto` — not provider-specific beyond "RS256 or
 * ES256, verified via a published JWKS," which is how `SupabaseAuthProvider`
 * (and any standards-compliant OIDC-style provider) issues tokens.
 */
export function verifyJwtSignature(token: string, jwks: Jwks): Record<string, unknown> | null {
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

  const alg = header.alg;
  if (!alg || !(alg in KTY_BY_ALG)) return null;
  const expectedKty = KTY_BY_ALG[alg];

  const jwk = jwks.keys.find((key) => key.kty === expectedKty && (!header.kid || key.kid === header.kid));
  if (!jwk) return null;

  let publicKey;
  try {
    if (alg === 'RS256') {
      if (!jwk.n || !jwk.e) return null;
      publicKey = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    } else {
      if (jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return null;
      publicKey = createPublicKey({ key: { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
    }
  } catch {
    return null;
  }

  const signedData = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = base64UrlDecode(signatureB64);

  let isValid: boolean;
  try {
    isValid =
      alg === 'RS256'
        ? cryptoVerify('RSA-SHA256', signedData, publicKey, signature)
        : // ES256's JWS signature is raw (r || s), not the DER encoding Node's
          // verify() assumes by default for EC keys — `dsaEncoding:
          // 'ieee-p1363'` tells it to expect the JOSE/JWS wire format instead.
          cryptoVerify('sha256', signedData, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return null;
  }

  return isValid ? payload : null;
}
