/** Thrown by `SessionService.refresh` for an unknown, already-rotated, or explicitly revoked refresh token — deliberately not distinguished further (ADR-0022 Decision 2: reuse of an already-rotated token is a compromise signal, not a routine error). */
export class SessionRevokedError extends Error {
  constructor() {
    super('Session has been revoked, or this refresh token is unknown.');
    this.name = 'SessionRevokedError';
  }
}

/** Thrown when the auth provider's token refresh endpoint rejects a refresh token — mirrors `OAuthExchangeFailedError`'s shape. */
export class AuthRefreshFailedError extends Error {
  constructor(provider: string, detail: string) {
    super(`Auth token refresh failed for "${provider}": ${detail}`);
    this.name = 'AuthRefreshFailedError';
  }
}
