import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import { PreferenceNotFoundError } from './errors';
import type { Preference, PreferenceCategory, SetPreferenceInput } from './types';

/**
 * The Preference Memory Layer (Phase 1.8): structured, categorized
 * preferences that shape assistant behavior, kept in their own table
 * rather than as `memory_records` (docs/decisions/0008-user-identity-and-
 * workspace-intelligence.md). `setPreference` is an upsert keyed on
 * (workspace, category, key) — preferences are settings, not a list of
 * independent items a user creates one at a time like tasks/drafts.
 */
export class PreferenceService {
  constructor(private readonly db: Queryable) {}

  async setPreference(input: SetPreferenceInput): Promise<Preference> {
    await this.assertWorkspaceExists(input.workspaceId);

    const result = await this.db.query(
      `INSERT INTO preferences (workspace_id, category, key, value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, category, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING id, workspace_id, category, key, value, created_at, updated_at`,
      [input.workspaceId, input.category, input.key, input.value],
    );

    return mapPreferenceRow(result.rows[0]);
  }

  async listPreferences(workspaceId: string, category?: PreferenceCategory): Promise<Preference[]> {
    const conditions = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const result = await this.db.query(
      `SELECT id, workspace_id, category, key, value, created_at, updated_at
       FROM preferences
       WHERE ${conditions.join(' AND ')}
       ORDER BY category, key`,
      params,
    );

    return result.rows.map(mapPreferenceRow);
  }

  async getPreference(workspaceId: string, preferenceId: string): Promise<Preference> {
    const result = await this.db.query(
      `SELECT id, workspace_id, category, key, value, created_at, updated_at
       FROM preferences WHERE id = $1 AND workspace_id = $2`,
      [preferenceId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new PreferenceNotFoundError(preferenceId, workspaceId);
    }

    return mapPreferenceRow(result.rows[0]);
  }

  async deletePreference(workspaceId: string, preferenceId: string): Promise<void> {
    const result = await this.db.query('DELETE FROM preferences WHERE id = $1 AND workspace_id = $2', [
      preferenceId,
      workspaceId,
    ]);

    if (result.rowCount === 0) {
      throw new PreferenceNotFoundError(preferenceId, workspaceId);
    }
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface PreferenceRow {
  id: string;
  workspace_id: string;
  category: PreferenceCategory;
  key: string;
  value: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapPreferenceRow(row: PreferenceRow): Preference {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    category: row.category,
    key: row.key,
    value: row.value,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
