import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
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

/**
 * The Integration Framework's workspace enable/disable and credential layer
 * (Phase 2.3, items 1 and 3) in one service — connecting, disconnecting,
 * and rotating a workspace's connection to one of the fixed providers, plus
 * the one internal accessor (`getDecryptedCredentials`) a future connector
 * caller would use to actually read data. Never exposed via a public route.
 */
export class IntegrationService {
  constructor(
    private readonly db: Queryable,
    private readonly integrationRegistry: IntegrationRegistry,
    private readonly connectors: Record<IntegrationProvider, IntegrationConnector>,
    private readonly encryptor: CredentialEncryptor,
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
      `SELECT id, workspace_id, provider, enabled, status, connected_at, last_validated_at, created_at, updated_at
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

    const result = await this.db.query<IntegrationRow>(
      `INSERT INTO workspace_integrations (workspace_id, provider, enabled, status, connected_at, last_validated_at)
       VALUES ($1, $2, true, 'connected', now(), now())
       ON CONFLICT (workspace_id, provider)
       DO UPDATE SET enabled = true, status = 'connected', connected_at = now(), last_validated_at = now(), updated_at = now()
       RETURNING id, workspace_id, provider, enabled, status, connected_at, last_validated_at, created_at, updated_at`,
      [input.workspaceId, input.provider],
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

    const result = await this.db.query<IntegrationRow>(
      `UPDATE workspace_integrations
       SET enabled = false, status = 'disconnected', updated_at = now()
       WHERE workspace_id = $1 AND provider = $2
       RETURNING id, workspace_id, provider, enabled, status, connected_at, last_validated_at, created_at, updated_at`,
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
      `SELECT id, workspace_id, provider, enabled, status, connected_at, last_validated_at, created_at, updated_at
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
       SET status = 'connected', last_validated_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING id, workspace_id, provider, enabled, status, connected_at, last_validated_at, created_at, updated_at`,
      [integrationId],
    );

    return mapIntegrationRow(updated.rows[0]);
  }

  /**
   * Decrypts and returns a connected integration's stored credentials —
   * internal-only, for a future connector caller (e.g. an approved
   * `read_email` action) to use. Never exposed via a public route: the API
   * surface only ever returns `WorkspaceIntegration` status metadata.
   */
  async getDecryptedCredentials(workspaceId: string, provider: IntegrationProvider): Promise<IntegrationCredentials> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query<{ encrypted_payload: string; iv: string; auth_tag: string }>(
      `SELECT ic.encrypted_payload, ic.iv, ic.auth_tag
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
    return JSON.parse(json) as IntegrationCredentials;
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
