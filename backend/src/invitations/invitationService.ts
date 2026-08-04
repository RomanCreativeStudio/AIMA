import type { Queryable } from '../db/queryable';
import type { NotificationService } from '../notifications/types';
import type { UserService } from '../users/userService';
import { UserAlreadyBetaTesterError } from './errors';
import type { CreateInvitationInput, Invitation, InvitationStatus } from './types';

/**
 * Beta Invitations & Notifications sprint: founder-issued invitations to prospective beta testers. Reuses
 * `UserService.getUserByEmail` (rather than a duplicate lookup query) to reject re-inviting someone already
 * an active beta tester. `notificationService` is optional — this class works identically with or without
 * one configured; see `WebhookNotificationService`'s doc comment for why a notification failure is caught
 * here too (defense in depth) rather than trusted to never throw.
 */
export class InvitationService {
  constructor(
    private readonly db: Queryable,
    private readonly userService: UserService,
    private readonly notificationService?: NotificationService,
  ) {}

  async createInvitation(input: CreateInvitationInput): Promise<Invitation> {
    const existing = await this.userService.getUserByEmail(input.email);
    if (existing?.preferences.betaTester === true) {
      throw new UserAlreadyBetaTesterError(input.email);
    }

    const result = await this.db.query(
      `INSERT INTO invitations (email, invited_by)
       VALUES ($1, $2)
       RETURNING id, email, invited_by, status, created_at`,
      [input.email, input.invitedBy],
    );
    const invitation = mapInvitationRow(result.rows[0]);

    if (this.notificationService) {
      try {
        await this.notificationService.notifyInvitationCreated(invitation);
      } catch {
        // Belt-and-suspenders: WebhookNotificationService already never throws on its own, but this
        // guarantees the invariant holds regardless of which NotificationService implementation is wired in
        // — a notification failure must never fail (or roll back) the invitation itself.
      }
    }

    return invitation;
  }

  /** Every invitation ever issued, newest first — the admin dashboard's invitations list. */
  async listInvitations(): Promise<Invitation[]> {
    const result = await this.db.query(
      `SELECT id, email, invited_by, status, created_at FROM invitations ORDER BY sequence DESC`,
    );
    return result.rows.map(mapInvitationRow);
  }

  /**
   * Invitation Acceptance & Lifecycle sprint: called by the login route immediately after
   * `UserService.getOrProvisionFromAuth` creates a brand-new profile — never on a returning user's login,
   * since only that "just created" branch tells the caller a signup actually happened. Transitions every
   * still-`pending` invitation for `email` to `accepted` with a single conditional UPDATE (`WHERE status =
   * 'pending'`), the same race-safety pattern `getOrInsertUserRow` already relies on for the user-row insert
   * itself: under READ COMMITTED, a concurrent call for the same email blocks on the row lock until the
   * first commits, then re-evaluates the WHERE clause against the now-`accepted` row and matches nothing —
   * so two overlapping calls can never both promote the account or double-accept. A no-op (and not an error)
   * when there is no pending invitation for `email` at all, the common case for anyone who signed up without
   * being invited.
   */
  async acceptInvitationFor(email: string, userId: string): Promise<void> {
    const result = await this.db.query(`UPDATE invitations SET status = 'accepted' WHERE email = $1 AND status = 'pending' RETURNING id`, [
      email,
    ]);
    if (result.rows.length === 0) return;

    // Safe to fully replace `preferences` rather than read-merge-write: this only ever runs immediately after
    // a brand-new profile is provisioned, whose `preferences` is still the column default `{}` — there is
    // nothing else to preserve yet.
    await this.userService.updateProfile(userId, { preferences: { betaTester: true } });
  }

  /**
   * Invitation Acceptance & Lifecycle sprint: a sweep, not a cron job — this codebase has no scheduling
   * infrastructure, and none is introduced for this. Call it explicitly (an ops script, a future admin
   * action) whenever stale pending invitations should be marked `expired`. Idempotent: re-running it only
   * ever matches rows still `pending` and past `olderThanDays`, so a repeat call (or two overlapping calls)
   * against the same data does nothing extra the second time.
   */
  async expirePendingInvitations(olderThanDays: number): Promise<Invitation[]> {
    const result = await this.db.query(
      `UPDATE invitations
       SET status = 'expired'
       WHERE status = 'pending' AND created_at < now() - make_interval(days => $1)
       RETURNING id, email, invited_by, status, created_at`,
      [olderThanDays],
    );
    return result.rows.map(mapInvitationRow);
  }
}

interface InvitationRow {
  id: string;
  email: string;
  invited_by: string;
  status: InvitationStatus;
  created_at: Date | string;
}

function mapInvitationRow(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    invitedBy: row.invited_by,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
