/** Thrown by `OAuthService.completeAuthorization` when `state` isn't one this process issued, has already been consumed, or has expired — the CSRF check every OAuth callback needs. */
export class OAuthStateInvalidError extends Error {
  constructor() {
    super('OAuth state is invalid, already used, or expired — restart the connection flow.');
    this.name = 'OAuthStateInvalidError';
  }
}

/** Thrown when a provider's token endpoint (or the callback itself) reports an error — e.g. the user declined consent, or the code was rejected. */
export class OAuthExchangeFailedError extends Error {
  constructor(provider: string, detail: string) {
    super(`OAuth token exchange failed for "${provider}": ${detail}`);
    this.name = 'OAuthExchangeFailedError';
  }
}
