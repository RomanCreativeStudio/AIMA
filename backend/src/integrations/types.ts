export const INTEGRATION_PROVIDERS = ['gmail', 'github', 'calendar'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export const INTEGRATION_STATUSES = ['disconnected', 'connected', 'error'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/**
 * Mirrors `workspace_integrations` (database/migrations/0011_integrations.sql),
 * minus its internal UUID primary key — `(workspaceId, provider)` is
 * already a unique, stable identifier for every route and client purpose,
 * so the row's own id stays an implementation detail of
 * `IntegrationService` (used only to link `integration_credentials`).
 * Never carries credential material — that lives only in
 * `integration_credentials`, reachable solely through
 * `IntegrationService.getDecryptedCredentials`, never serialized in an API
 * response.
 */
export interface WorkspaceIntegration {
  workspaceId: string;
  provider: IntegrationProvider;
  enabled: boolean;
  status: IntegrationStatus;
  connectedAt: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the stored OAuth access token expires, or null if it doesn't (or the provider never reported an expiry) — Phase 2.7's "Token expiration" client affordance. Never the token itself, which stays exclusively in encrypted `integration_credentials`. */
  tokenExpiresAt: string | null;
}

/** Free-form key/value credential material (e.g. `{ accessToken, refreshToken }`) — shape varies per provider. */
export type IntegrationCredentials = Record<string, string>;

export interface ConnectIntegrationInput {
  workspaceId: string;
  provider: IntegrationProvider;
  credentials: IntegrationCredentials;
}

export interface RotateIntegrationCredentialsInput {
  workspaceId: string;
  provider: IntegrationProvider;
  credentials: IntegrationCredentials;
}
