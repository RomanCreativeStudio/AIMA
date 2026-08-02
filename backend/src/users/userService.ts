import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import { UserNotFoundError } from './errors';
import type { CreateUserInput, UpdateUserProfileInput, UserProfile } from './types';

/**
 * The User Profile System (Phase 1.8): a single account's identity and
 * preferences. This is a single-user MVP (docs/PRODUCT_BIBLE.md) — there is
 * no self-serve signup, so `createUser` (a client-supplied `id`-less insert,
 * relying on `gen_random_uuid()`) exists for seeding/tests, not as a public
 * capability. The real production path for a brand-new account is
 * `getOrProvisionFromAuth`, called from the login route (ADR-0022 v1.1,
 * EPIC-006 Sprint 6.4): only reading and updating an existing profile is
 * otherwise exposed over HTTP (backend/src/routes/users.ts).
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

  /**
   * Returns the profile for `id` if one already exists; otherwise creates
   * it — `id = id` (the verified JWT subject, never a freshly generated
   * UUID — ADR-0022 Decision 4), `email = email`, `display_name = null` —
   * and returns that. This is the auto-provisioning path the login route
   * calls on every successful authentication (ADR-0022 v1.1, EPIC-006
   * Sprint 6.4): a Supabase Auth user with no matching `public.users` row
   * yet (first login) gets one created transparently instead of failing
   * with `UserNotFoundError`.
   *
   * Idempotent and race-safe: `ON CONFLICT (id) DO NOTHING` means two
   * concurrent first logins for the same brand-new subject can't both
   * insert a row (one wins, the other affects zero rows); the loser then
   * reads back the winner's row via `getUser` rather than erroring, so
   * every caller — first or racing-second — gets the same profile back.
   * An already-existing profile is never modified here (its `email`/
   * `display_name` are left exactly as they are), matching "if found,
   * continue exactly as today."
   */
  async getOrProvisionFromAuth(id: string, email: string): Promise<UserProfile> {
    try {
      return await this.getUser(id);
    } catch (error) {
      if (!(error instanceof UserNotFoundError)) throw error;
    }

    const inserted = await this.db.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, $2, NULL)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, email, display_name, preferences, communication_style, default_workspace_id, created_at, updated_at`,
      [id, email],
    );

    if (inserted.rows.length > 0) {
      return mapUserRow(inserted.rows[0]);
    }

    // Lost the race — a concurrent call already inserted this id between
    // our getUser() check and this insert. Its row is now the true state;
    // read it back instead of treating the conflict as an error.
    return this.getUser(id);
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
