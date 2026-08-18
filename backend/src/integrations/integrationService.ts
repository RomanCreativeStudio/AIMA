import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import type { OAuthProvider } from '../oauth/types';
import type { IntegrationConnector } from './connectors/types';
import type { CredentialEncryptor } from './encryption';
import { IntegrationConnectionFailedError, IntegrationNotFoundError, InvalidCredentialsError } from './errors';
import type { IntegrationDefinition, IntegrationRegistry } from './registry';
import type {
  ConnectIntegrationInput,
  IntegrationCredentials,
  IntegrationProvider,
  RotateIntegrationCredentialsInput,
  WorkspaceIntegration,
} from './types';

/** A token set is treated as expired slightly before its real deadline, so a request never races a token that's technically still valid but about to lapse mid-call. */
const EXPIRY_BUFFER_MS = 60_000;

/**
 * The Integration Framework's workspace enable/disable and credential layer
 * (Phase 2.3, items 1 and 3; extended Phase 2.7 with OAuth token rotation
 * and disconnect revocation) in one service — connecting, disconnecting,
 * and rotating a workspace's connection to one of the fixed providers, plus
 * the one internal accessor (`getDecryptedCredentials`) a connector caller
 * (a workflow handler, an `ActionExecutor`) uses to actually read data.
 * Never exposed via a public route. `oauthProviders` is optional (defaults
 * to `{}`) purely so every pre-Phase-2.7 test construction of this class
 * keeps compiling unchanged — a provider with no entry here simply never
 * auto-refreshes or revokes, which is exactly today's (Phase 2.3–2.6)
 * behavior.
 */
export class IntegrationService {
  constructor(
    private readonly db: Queryable,
    private readonly integrationRegistry: IntegrationRegistry,
    private readonly connectors: Record<IntegrationProvider, IntegrationConnector>,
    private readonly encryptor: CredentialEncryptor,
    private readonly oauthProviders: Partial<Record<IntegrationProvider, OAuthProvider>> = {},
  ) {}

  /**
   * Every registered provider always appears, defaulted to a disconnected
   * placeholder if the workspace has never connected it — so the
   * Integrations screen (Phase 2.3, item 5) can render a fixed three-row
   * list without special-casing "not yet connected."
   */
  async listForWorkspace(workspaceId: string): Promise<WorkspaceIntegration[]> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query<IntegrationRow>(
      `SELECT id, workspace_id, provider, enabled, status, connected_at, last_validated_at, token_expires_at, created_at, updated_at
       FROM workspace_integrations WHERE workspace_id = $1`,
      [workspaceId],
    );
    const byProvider = new Map(result.rows.map((row) => [row.provider, row]));

    return this.integrationRegistry.list().map((definition) => {
      const row = byProvider.get(definition.provider);
      return row ? mapIntegrationRow(row) : defaultIntegration(workspaceId, definition.provider);
    });
  }

  async connect(input: ConnectIntegrationInput): Promise<WorkspaceIntegration> {
    await this.assertWorkspaceExists(input.workspaceId);
    const definition = this.getDefinition(input.provider);
    this.validateCredentials(definition, input.credentials);

    const connectionResult = await this.connectors[input.provider].testConnection(input.credentials);
    if (!connectionResult.ok) {
      throw new IntegrationConnectionFailedError(input.provider, connectionResult.detail);
    }

    const tokenExpiresAt = toDateOrNull(input.credentials.expiresAt);
    const result = await this.db.query<IntegrationRow>(
      `INSERT INTO workspace_integrations (workspace_id, provider, enabled, status, connected_at, last_validated_at, token_expires_at)
       VALUES ($1, $2, true, 'connected', now(), now(), $3)
       ON CONFLICT (workspace_id, provider)
       DO UPDATE SET enabled = true, status = 'connected', connected_at = now(), last_validated_at = now(), token_expires_at = $3, updated_at = now()
       RETURNING id, workspace_id, provider, enabled, status, connected_at, last_validated_at, token_expires_at, created_at, updated_at`,
      [input.workspaceId, input.provider, tokenExpiresAt],
    );
    const row = result.rows[0];

    const encrypted = this.encryptor.encrypt(JSON.stringify(input.credentials));
    await this.db.query(
      `INSERT INTO integration_credentials (integration_id, encrypted_payload, iv, auth_tag)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (integration_id)
       DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, updated_at = now()`,
      [row.id, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
    );

    return mapIntegrationRow(row);
  }

  async disconnect(workspaceId: string, provider: IntegrationProvider): Promise<WorkspaceIntegration> {
    await this.assertWorkspaceExists(workspaceId);
    this.getDefinition(provider);

    // Best-effort revocation (Phase 2.7, item 4: "Disconnect cleanup") —
    // attempted before the row is touched, since it needs the still-present
    // encrypted credentials. A revoke failure (provider down, token already
    // invalid) must never block disconnecting locally, so errors are
    // swallowed rather than surfaced.
    const oauthProvider = this.oauthProviders[provider];
    if (oauthProvider) {
      try {
        const credentials = await this.getDecryptedCredentials(workspaceId, provider);
        await oauthProvider.revokeToken(credentials.accessToken);
      } catch {
        // Nothing connected, or the provider rejected the revoke — either way, proceed with local disconnect.
      }
    }

    const result = await this.db.query<IntegrationRow>(
      `UPDATE workspace_integrations
       SET enabled = false, status = 'disconnected', token_expires_at = NULL, updated_at = now()
       WHERE workspace_id = $1 AND provider = $2
       RETURNING id, workspace_id, provider, enabled, status, connected_at, last_validated_at, token_expires_at, created_at, updated_at`,
      [workspaceId, provider],
    );
    if (result.rows.length === 0) {
      throw new IntegrationNotFoundError(workspaceId, provider);
    }

    // No reason to keep a secret around for a disabled integration — a
    // future reconnect goes through `connect` again with fresh credentials.
    await this.db.query('DELETE FROM integration_credentials WHERE integration_id = $1', [result.rows[0].id]);

    return mapIntegrationRow(result.rows[0]);
  }

  async rotate(input: RotateIntegrationCredentialsInput): Promise<WorkspaceIntegration> {
    await this.assertWorkspaceExists(input.workspaceId);
    const definition = this.getDefinition(input.provider);
    this.validateCredentials(definition, input.credentials);

    const existing = await this.db.query<IntegrationRow>(
      `SELECT id, workspace_id, provider, enabled, status, connected_at, last_validated_at, token_expires_at, created_at, updated_at
       FROM workspace_integrations WHERE workspace_id = $1 AND provider = $2 AND enabled = true`,
      [input.workspaceId, input.provider],
    );
    if (existing.rows.length === 0) {
      throw new IntegrationNotFoundError(input.workspaceId, input.provider);
    }

    const connectionResult = await this.connectors[input.provider].testConnection(input.credentials);
    if (!connectionResult.ok) {
      throw new IntegrationConnectionFailedError(input.provider, connectionResult.detail);
    }

    const integrationId = existing.rows[0].id;
    const encrypted = this.encryptor.encrypt(JSON.stringify(input.credentials));
    await this.db.query(
      `UPDATE integration_credentials
       SET encrypted_payload = $1, iv = $2, auth_tag = $3, updated_at = now(), rotated_at = now()
       WHERE integration_id = $4`,
      [encrypted.ciphertext, encrypted.iv, encrypted.authTag, integrationId],
    );

    const updated = await this.db.query<IntegrationRow>(
      `UPDATE workspace_integrations
       SET status = 'connected', last_validated_at = now(), token_expires_at = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, workspace_id, provider, enabled, status, connected_at, last_validated_at, token_expires_at, created_at, updated_at`,
      [integrationId, toDateOrNull(input.credentials.expiresAt)],
    );

    return mapIntegrationRow(updated.rows[0]);
  }

  /**
   * Decrypts and returns a connected integration's stored credentials —
   * internal-only, for a future connector caller (e.g. an approved
   * `read_email` action) to use. Never exposed via a public route: the API
   * surface only ever returns `WorkspaceIntegration` status metadata.
   */
  /**
   * Transparently refreshes an expired access token before returning it
   * (Phase 2.7, item 4: "Refresh tokens"/"Token rotation") — the one place
   * this needs to happen so every caller (a workflow handler, an
   * `ActionExecutor`) always gets a token that's actually still valid,
   * without `ExecutionService`/`WorkflowService` needing any change of
   * their own (item 6: "invoke live providers without API changes"). Only
   * attempted when this provider has a registered `OAuthProvider` and the
   * stored credentials actually carry a refresh token and an expiry —
   * manually-entered credentials (no `expiresAt`) are returned as-is.
   */
  async getDecryptedCredentials(workspaceId: string, provider: IntegrationProvider): Promise<IntegrationCredentials> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query<{ integration_id: string; encrypted_payload: string; iv: string; auth_tag: string }>(
      `SELECT wi.id AS integration_id, ic.encrypted_payload, ic.iv, ic.auth_tag
       FROM workspace_integrations wi
       JOIN integration_credentials ic ON ic.integration_id = wi.id
       WHERE wi.workspace_id = $1 AND wi.provider = $2 AND wi.enabled = true`,
      [workspaceId, provider],
    );
    if (result.rows.length === 0) {
      throw new IntegrationNotFoundError(workspaceId, provider);
    }

    const row = result.rows[0];
    const json = this.encryptor.decrypt({ ciphertext: row.encrypted_payload, iv: row.iv, authTag: row.auth_tag });
    const credentials = JSON.parse(json) as IntegrationCredentials;

    const oauthProvider = this.oauthProviders[provider];
    if (!oauthProvider || !credentials.refreshToken || !this.isExpired(credentials.expiresAt)) {
      return credentials;
    }

    const refreshed = await oauthProvider.refreshAccessToken(credentials.refreshToken);
    const updatedCredentials: IntegrationCredentials = {
      ...credentials,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
      expiresAt: refreshed.expiresAt ?? '',
    };
    await this.persistRefreshedCredentials(row.integration_id, updatedCredentials);
    return updatedCredentials;
  }

  private isExpired(expiresAt: string | undefined): boolean {
    if (!expiresAt) {
      return false; // no expiry reported — e.g. a classic, non-expiring GitHub OAuth token.
    }
    const expiryTime = new Date(expiresAt).getTime();
    return Number.isFinite(expiryTime) && expiryTime <= Date.now() + EXPIRY_BUFFER_MS;
  }

  private async persistRefreshedCredentials(integrationId: string, credentials: IntegrationCredentials): Promise<void> {
    const encrypted = this.encryptor.encrypt(JSON.stringify(credentials));
    await this.db.query(
      `UPDATE integration_credentials
       SET encrypted_payload = $1, iv = $2, auth_tag = $3, updated_at = now(), rotated_at = now()
       WHERE integration_id = $4`,
      [encrypted.ciphertext, encrypted.iv, encrypted.authTag, integrationId],
    );
    await this.db.query(
      `UPDATE workspace_integrations SET token_expires_at = $1, last_validated_at = now(), updated_at = now() WHERE id = $2`,
      [toDateOrNull(credentials.expiresAt), integrationId],
    );
  }

  private getDefinition(provider: IntegrationProvider): IntegrationDefinition {
    const definition = this.integrationRegistry.get(provider);
    if (!definition) {
      throw new Error(`Unregistered integration provider: "${provider}"`);
    }
    return definition;
  }

  private validateCredentials(definition: IntegrationDefinition, credentials: IntegrationCredentials): void {
    const missing = definition.requiredCredentialFields.filter((field) => !credentials[field]?.trim());
    if (missing.length > 0) {
      throw new InvalidCredentialsError(definition.provider, missing);
    }
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface IntegrationRow {
  id: string;
  workspace_id: string;
  provider: IntegrationProvider;
  enabled: boolean;
  status: WorkspaceIntegration['status'];
  connected_at: Date | string | null;
  last_validated_at: Date | string | null;
  token_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapIntegrationRow(row: IntegrationRow): WorkspaceIntegration {
  return {
    workspaceId: row.workspace_id,
    provider: row.provider,
    enabled: row.enabled,
    status: row.status,
    connectedAt: toIsoOrNull(row.connected_at),
    lastValidatedAt: toIsoOrNull(row.last_validated_at),
    tokenExpiresAt: toIsoOrNull(row.token_expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** The placeholder for a provider a workspace has never connected — no `workspace_integrations` row exists yet, so timestamps are simply absent. */
function defaultIntegration(workspaceId: string, provider: IntegrationProvider): WorkspaceIntegration {
  return {
    workspaceId,
    provider,
    enabled: false,
    status: 'disconnected',
    connectedAt: null,
    lastValidatedAt: null,
    tokenExpiresAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

/** `credentials.expiresAt` is a plain string field inside the encrypted JSON blob (empty string = "no expiry") — this converts it to the nullable timestamp `workspace_integrations.token_expires_at` actually stores. */
function toDateOrNull(expiresAt: string | undefined): string | null {
  if (!expiresAt) {
    return null;
  }
  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
