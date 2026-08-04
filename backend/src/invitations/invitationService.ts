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
