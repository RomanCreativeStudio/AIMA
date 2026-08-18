import { createHash } from 'node:crypto';
import type { Queryable } from '../db/queryable';
import { SessionRevokedError } from './errors';
import type { AuthProvider, IssuedTokens } from './types';

export interface AuthSession {
  id: string;
  userId: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

/** SHA-256 hex digest of a refresh token — the raw token is never stored (ADR-0022 Decision 3). */
export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

/**
 * Owns the local session/device record (`auth_sessions`, ADR-0022
 * Decision 3) — the authoritative source for "which devices are signed
 * in" and "is this session still valid," independent of the
 * `AuthProvider`'s own state. Access-token verification
 * (`AuthProvider.verifyAccessToken`, stateless JWT check) never touches
 * this table or this service; only session creation, refresh, revocation,
 * and listing do.
 */
export class SessionService {
  constructor(
    private readonly db: Queryable,
    private readonly authProvider: AuthProvider,
  ) {}

  /** Records a new session after a successful login/token issuance (the login flow itself is out of scope for this foundation layer — see REQ-001-PLAN's API placeholders). */
  async createSession(userId: string, refreshToken: string, deviceLabel?: string): Promise<AuthSession> {
    const result = await this.db.query<AuthSessionRow>(
      `INSERT INTO auth_sessions (user_id, device_label, refresh_token_hash)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, device_label, created_at, last_seen_at, revoked_at`,
      [userId, deviceLabel ?? null, hashRefreshToken(refreshToken)],
    );

    return mapSessionRow(result.rows[0]);
  }

  /**
   * Validates and rotates a refresh token (ADR-0022 Decision 2). Throws
   * `SessionRevokedError` for a refresh token this process never issued,
   * or whose session has already been revoked (explicitly, or because the
   * token was already rotated once and is being reused — the same error
   * either way, deliberately: the caller-facing signal for "reuse
   * detected" and "revoked" should not be distinguishable).
   */
  async refresh(refreshToken: string): Promise<{ tokens: IssuedTokens; session: AuthSession }> {
    const existing = await this.db.query<AuthSessionRow>(
      `SELECT id, user_id, device_label, created_at, last_seen_at, revoked_at
       FROM auth_sessions WHERE refresh_token_hash = $1`,
      [hashRefreshToken(refreshToken)],
    );

    if (existing.rows.length === 0 || existing.rows[0].revoked_at) {
      throw new SessionRevokedError();
    }

    const sessionId = existing.rows[0].id;
    const tokens = await this.authProvider.refreshSession(refreshToken);

    const updated = await this.db.query<AuthSessionRow>(
      `UPDATE auth_sessions
       SET refresh_token_hash = $1, last_seen_at = now()
       WHERE id = $2
       RETURNING id, user_id, device_label, created_at, last_seen_at, revoked_at`,
      [hashRefreshToken(tokens.refreshToken), sessionId],
    );

    return { tokens, session: mapSessionRow(updated.rows[0]) };
  }

  /** Revokes a session locally — the authoritative action (ADR-0022 Decision 3). Idempotent: revoking an already-revoked or unknown session is a no-op, not an error. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
      sessionId,
    ]);
  }

  /** Lists a user's sessions for the "signed in devices" UI (ADR-0022 Decision 3) — a local read, no provider call, no expiry filtering (revoked sessions are included so the UI can show recently-revoked entries if desired). */
  async listSessions(userId: string): Promise<AuthSession[]> {
    const result = await this.db.query<AuthSessionRow>(
      `SELECT id, user_id, device_label, created_at, last_seen_at, revoked_at
       FROM auth_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [userId],
    );

    return result.rows.map(mapSessionRow);
  }

  /** Reads a single session by id (EPIC-004 Sprint 4.6) — a local read, no provider call. Used by the session-delete route to check ownership before revoking. Returns `null` if no such session exists. */
  async getSession(sessionId: string): Promise<AuthSession | null> {
    const result = await this.db.query<AuthSessionRow>(
      `SELECT id, user_id, device_label, created_at, last_seen_at, revoked_at
       FROM auth_sessions WHERE id = $1`,
      [sessionId],
    );

    return result.rows.length > 0 ? mapSessionRow(result.rows[0]) : null;
  }

  /** Reads a single session by its current refresh token (EPIC-004 Sprint 4.6) — a read-only lookup, distinct from `refresh()` which also rotates. Used by the logout route to identify "the current session" from the refresh token the client presents. Returns `null` if no session matches. */
  async findByRefreshToken(refreshToken: string): Promise<AuthSession | null> {
    const result = await this.db.query<AuthSessionRow>(
      `SELECT id, user_id, device_label, created_at, last_seen_at, revoked_at
       FROM auth_sessions WHERE refresh_token_hash = $1`,
      [hashRefreshToken(refreshToken)],
    );

    return result.rows.length > 0 ? mapSessionRow(result.rows[0]) : null;
  }
}

interface AuthSessionRow {
  id: string;
  user_id: string;
  device_label: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
}

function mapSessionRow(row: AuthSessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    deviceLabel: row.device_label,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
