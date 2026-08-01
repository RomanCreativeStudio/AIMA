/**
 * What `AuthProvider.verifyAccessToken` resolves a valid token to — the
 * identity downstream code (`requireAuth` middleware) attaches to the
 * request. `subjectId` maps directly onto `users.id` (ADR-0022 Decision 4:
 * no separate mapping column).
 */
export interface VerifiedAccessToken {
  subjectId: string;
  /** ISO 8601 — when this specific access token expires. */
  expiresAt: string;
}

/** A freshly issued or refreshed access/refresh token pair (ADR-0022 Decision 2). */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 — the new access token's expiry. */
  accessTokenExpiresAt: string;
}

/**
 * The managed auth provider's contract (docs/decisions/
 * 0022-authentication-architecture.md, Decision 1) — mirrors the
 * `OAuthProvider`/`SpeechToTextProvider` abstraction pattern already used
 * throughout this codebase: callers depend only on this interface, never a
 * concrete vendor.
 */
export interface AuthProvider {
  /**
   * Exchanges an email/password credential pair for a fresh token pair
   * (EPIC-004 Sprint 4.6) — the direct-credential-exchange login flow
   * `REQ-001-PLAN`'s API placeholders named as one of the two options,
   * "depends on the chosen provider." ADR-0022 already chose Supabase
   * Auth, whose GoTrue API exposes exactly this grant type — this is not
   * a new provider or an invented OAuth flow, just implementing the login
   * mechanics the already-decided provider supports. Throws
   * `AuthLoginFailedError` if the provider rejects the credentials.
   */
  signInWithPassword(email: string, password: string): Promise<IssuedTokens>;

  /**
   * Verifies an access token's signature and expiry, returning the
   * identity it resolves to. Self-contained/local (ADR-0022 Decision 2) —
   * implementations must not make a network call for this on the ordinary
   * request path. Returns `null` for any invalid token (malformed, bad
   * signature, expired, unknown signing key) — deliberately not
   * distinguished further, so callers can't be used to probe why a token
   * failed.
   */
  verifyAccessToken(accessToken: string): Promise<VerifiedAccessToken | null>;

  /**
   * Exchanges a refresh token for a fresh token pair, rotating the refresh
   * token (ADR-0022 Decision 2). Throws `AuthRefreshFailedError` if the
   * provider rejects the refresh token.
   */
  refreshSession(refreshToken: string): Promise<IssuedTokens>;

  /**
   * Best-effort courtesy revocation with the provider — mirrors
   * `OAuthProvider.revokeToken`'s documented convention exactly: callers
   * must treat failure as non-fatal. The authoritative revocation
   * mechanism is the local `auth_sessions` record (ADR-0022 Decision 3),
   * not this call.
   */
  revokeSession(token: string): Promise<void>;
}
