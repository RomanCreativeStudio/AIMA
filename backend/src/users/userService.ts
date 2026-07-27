import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import { UserNotFoundError } from './errors';
import type { CreateUserInput, UpdateUserProfileInput, UserProfile } from './types';

/**
 * The User Profile System (Phase 1.8): a single account's identity and
 * preferences. This is a single-user MVP (docs/PRODUCT_BIBLE.md) — there is
 * no signup/auth flow, so `createUser` exists for seeding/tests, not as a
 * public capability; only reading and updating an existing profile is
 * exposed over HTTP (backend/src/routes/users.ts).
 */
export class UserService {
  constructor(private readonly db: Queryable) {}

  async createUser(input: CreateUserInput): Promise<UserProfile> {
    const result = await this.db.query(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       RETURNING id, email, display_name, preferences, communication_style, default_workspace_id, created_at, updated_at`,
      [input.email, input.displayName ?? null],
    );

    return mapUserRow(result.rows[0]);
  }

  async getUser(userId: string): Promise<UserProfile> {
    const result = await this.db.query(
      `SELECT id, email, display_name, preferences, communication_style, default_workspace_id, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      throw new UserNotFoundError(userId);
    }

    return mapUserRow(result.rows[0]);
  }

  async updateProfile(userId: string, updates: UpdateUserProfileInput): Promise<UserProfile> {
    await this.getUser(userId); // existence check

    if (updates.defaultWorkspaceId) {
      const workspace = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1 AND user_id = $2', [
        updates.defaultWorkspaceId,
        userId,
      ]);
      if (workspace.rows.length === 0) {
        // Reported identically whether the workspace doesn't exist at all or
        // belongs to a different user — same isolation pattern as every
        // other workspace-scoped lookup in this codebase.
        throw new WorkspaceNotFoundError(updates.defaultWorkspaceId);
      }
    }

    const fields: string[] = [];
    const params: unknown[] = [];

    const set = (column: string, value: unknown) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };

    if (updates.displayName !== undefined) set('display_name', updates.displayName);
    if (updates.preferences !== undefined) set('preferences', JSON.stringify(updates.preferences));
    if (updates.communicationStyle !== undefined) set('communication_style', updates.communicationStyle);
    if (updates.defaultWorkspaceId !== undefined) set('default_workspace_id', updates.defaultWorkspaceId);

    if (fields.length === 0) {
      return this.getUser(userId);
    }

    fields.push('updated_at = now()');
    params.push(userId);

    const result = await this.db.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, email, display_name, preferences, communication_style, default_workspace_id, created_at, updated_at`,
      params,
    );

    return mapUserRow(result.rows[0]);
  }
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  preferences: Record<string, unknown>;
  communication_style: string | null;
  default_workspace_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapUserRow(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    preferences: row.preferences,
    communicationStyle: row.communication_style,
    defaultWorkspaceId: row.default_workspace_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
