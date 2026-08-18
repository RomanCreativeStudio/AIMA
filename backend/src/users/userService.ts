import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkspaceSlug } from '../types/workspace';
import { WorkspaceAlreadyExistsError } from '../workspaces/errors';
import type { Workspace } from '../workspaces/types';
import { WorkspaceService } from '../workspaces/workspaceService';
import { UserNotFoundError } from './errors';
import type { CreateUserInput, UpdateUserProfileInput, UserProfile } from './types';

/** The slug `getOrProvisionFromAuth` creates a brand-new profile's one default workspace with. */
const DEFAULT_WORKSPACE_SLUG: WorkspaceSlug = 'personal';

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
   * Also ensures the profile has at least one workspace: a profile with
   * zero workspaces (a brand-new one, or one left behind by a provisioning
   * attempt that created the user row but failed before creating a
   * workspace) gets a single default workspace created and set as
   * `defaultWorkspaceId`. A profile that already has at least one
   * workspace is never touched by this step — existing accounts are not
   * affected, and nothing here ever overwrites an already-set default.
   * Race-safe the same way the user-row insert above is: the workspace's
   * `(user_id, slug)` uniqueness constraint lets only one concurrent
   * provisioning attempt actually insert, and the loser reads back the
   * winner's workspace instead of erroring.
   *
   * Not atomic across the user-row insert and the workspace insert — this
   * codebase has no cross-statement transaction wrapper, and none was
   * introduced for this. If the process dies in between, the next call for
   * the same `id` finds the user row already there, sees zero workspaces,
   * and finishes the job — self-healing on retry rather than leaving a
   * permanently broken account.
   *
   * `isNewProfile` (Invitation Acceptance & Lifecycle sprint) is true exactly when this call is the one that
   * inserted the `users` row — never for an already-existing profile, and never for the loser of a
   * concurrent insert race (see `getOrInsertUserRow`). The login route uses it to gate invitation
   * acceptance: an invitation must only ever be consumed by a genuine first-time signup, not by every
   * subsequent login from the same account.
   */
  async getOrProvisionFromAuth(id: string, email: string): Promise<{ user: UserProfile; isNewProfile: boolean }> {
    const { user, isNewProfile } = await this.getOrInsertUserRow(id, email);

    const workspaceService = new WorkspaceService(this.db);
    const workspaces = await workspaceService.listWorkspaces(user.id);
    if (workspaces.length > 0) {
      return { user, isNewProfile };
    }

    const workspace = await this.provisionDefaultWorkspace(workspaceService, user.id);
    const withDefaultWorkspace = await this.updateProfile(user.id, { defaultWorkspaceId: workspace.id });
    return { user: withDefaultWorkspace, isNewProfile };
  }

  private async getOrInsertUserRow(id: string, email: string): Promise<{ user: UserProfile; isNewProfile: boolean }> {
    try {
      return { user: await this.getUser(id), isNewProfile: false };
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
      return { user: mapUserRow(inserted.rows[0]), isNewProfile: true };
    }

    // Lost the race — a concurrent call already inserted this id between
    // our getUser() check and this insert. Its row is now the true state;
    // read it back instead of treating the conflict as an error. Not the
    // winner, so isNewProfile is false here too — only the call that
    // actually performed the insert reports true.
    return { user: await this.getUser(id), isNewProfile: false };
  }

  private async provisionDefaultWorkspace(workspaceService: WorkspaceService, userId: string): Promise<Workspace> {
    try {
      return await workspaceService.createWorkspace({ userId, slug: DEFAULT_WORKSPACE_SLUG, name: 'Personal' });
    } catch (error) {
      if (!(error instanceof WorkspaceAlreadyExistsError)) throw error;

      // Lost the race — a concurrent provisioning attempt for the same user already created this workspace.
      const workspaces = await workspaceService.listWorkspaces(userId);
      const existing = workspaces.find((workspace) => workspace.slug === DEFAULT_WORKSPACE_SLUG);
      if (!existing) throw error;
      return existing;
    }
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

  /**
   * Every account, newest first — the Internal Operator Dashboard sprint's one legitimate cross-account
   * read. Every other method here is scoped to a single caller's own `userId`; this is deliberately not,
   * which is exactly why it's only ever called from `AdminService` (behind `requireAdmin`), never from a
   * route a regular authenticated user can reach.
   */
  async listUsers(): Promise<UserProfile[]> {
    const result = await this.db.query(
      `SELECT id, email, display_name, preferences, communication_style, default_workspace_id, created_at, updated_at
       FROM users ORDER BY created_at DESC`,
    );
    return result.rows.map(mapUserRow);
  }

  /**
   * Beta Invitations & Notifications sprint: looks a profile up by email rather than id — used only to check
   * whether a prospective invitee is already an active beta tester before `InvitationService.createInvitation`
   * sends another invite. Returns `null` for no match (an invitee usually has no `users` row yet at all)
   * rather than throwing, unlike `getUser`, since "not found" is the expected, common case here.
   */
  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const result = await this.db.query(
      `SELECT id, email, display_name, preferences, communication_style, default_workspace_id, created_at, updated_at
       FROM users WHERE email = $1`,
      [email],
    );
    return result.rows.length === 0 ? null : mapUserRow(result.rows[0]);
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
