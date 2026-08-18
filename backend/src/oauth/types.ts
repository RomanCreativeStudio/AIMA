import type { IntegrationProvider } from '../integrations/types';

/**
 * The result of a token exchange or refresh — the shape `OAuthService`
 * hands to `IntegrationService.connect`/an internal refresh, never returned
 * to a client directly. `refreshToken`/`expiresAt` are both nullable:
 * GitHub's classic OAuth Apps issue non-expiring tokens with no refresh
 * token unless the app has opted into token expiration.
 */
export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601, or null if the token does not expire (or the provider doesn't report an expiry). */
  expiresAt: string | null;
  scope?: string;
}

/**
 * One provider's OAuth 2.0 authorization-code flow (Phase 2.7, item 4) —
 * mirrors the `IntegrationConnector`/`ActionExecutor` provider-abstraction
 * pattern already used throughout this module: `OAuthService` depends only
 * on this interface, never on a concrete Google/GitHub implementation.
 */
export interface OAuthProvider {
  readonly provider: IntegrationProvider;
  /** Builds the URL the user's browser is sent to. `state` is opaque — verified, never interpreted, by the caller. */
  getAuthorizationUrl(state: string): string;
  /** Exchanges a one-time authorization code for a token set. */
  exchangeCode(code: string): Promise<OAuthTokenSet>;
  /** Exchanges a refresh token for a fresh access token (and, if the provider rotates them, a fresh refresh token). */
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet>;
  /** Best-effort revocation on disconnect — callers must treat failures as non-fatal (docs/decisions/0015-live-integration-providers.md). */
  revokeToken(accessToken: string): Promise<void>;
}
