import type { PermissionTier } from '../permissions/types';
import type { Queryable } from '../db/queryable';

export interface ActionLogEntry {
  workspaceId: string;
  capabilityId?: string;
  tier: PermissionTier;
  summary: string;
  payload?: unknown;
  outcome: 'success' | 'failure';
}

/** One `action_log` row as read back (Phase 2.5's "recent activity"). `actionType` is null for entries with no `capability_id` — nothing currently logs without one, but the LEFT JOIN keeps this method safe if that ever changes. */
export interface ActionLogRecord {
  id: string;
  workspaceId: string;
  actionType: string | null;
  tier: PermissionTier;
  summary: string;
  payload: unknown;
  outcome: 'success' | 'failure';
  createdAt: string;
}

export interface ActionOutcomeCounts {
  success: number;
  failure: number;
  total: number;
}

interface ActionLogRow {
  id: string;
  workspace_id: string;
  action_type: string | null;
  tier: PermissionTier;
  summary: string;
  payload: unknown;
  outcome: 'success' | 'failure';
  created_at: string;
}

/**
 * Writes to the action_log table (database/migrations/0001_init.sql). Every
 * Tier 3/4 execution must go through this before returning success to the
 * user (docs/TECHNICAL_ARCHITECTURE.md §5) — logging is not optional and not
 * best-effort.
 */
export class ActionLogger {
  constructor(private readonly pool: Queryable) {}

  async log(entry: ActionLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO action_log (workspace_id, capability_id, tier, summary, payload, outcome)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.workspaceId,
        entry.capabilityId ?? null,
        entry.tier,
        entry.summary,
        entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
        entry.outcome,
      ],
    );
  }

  /**
   * A workspace's most recent actions, newest first (Phase 2.5's "recent
   * activity"). Ordered by the monotonic `sequence` column
   * (`database/migrations/0013_action_log_sequence.sql`) rather than
   * `created_at` — the same frozen-`now()` fix already applied to
   * `messages`/`pending_approvals`/`conversations`/`workflow_runs`: several
   * actions logged within one request can share an identical `created_at`
   * under READ COMMITTED, which would otherwise leave their relative order
   * undefined.
   */
  async list(workspaceId: string, limit = 20): Promise<ActionLogRecord[]> {
    const result = await this.pool.query<ActionLogRow>(
      `SELECT al.id, al.workspace_id, c.action_type, al.tier, al.summary, al.payload, al.outcome, al.created_at
       FROM action_log al
       LEFT JOIN capabilities c ON c.id = al.capability_id
       WHERE al.workspace_id = $1
       ORDER BY al.sequence DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
    return result.rows.map(mapActionLogRow);
  }

  /** Success/failure counts for a workspace's entire action_log history — the basis of Workspace Insights' activity metrics. */
  async countByOutcome(workspaceId: string): Promise<ActionOutcomeCounts> {
    const result = await this.pool.query<{ outcome: 'success' | 'failure'; count: string }>(
      `SELECT outcome, COUNT(*)::text AS count FROM action_log WHERE workspace_id = $1 GROUP BY outcome`,
      [workspaceId],
    );

    const counts: ActionOutcomeCounts = { success: 0, failure: 0, total: 0 };
    for (const row of result.rows) {
      const count = Number(row.count);
      counts[row.outcome] = count;
      counts.total += count;
    }
    return counts;
  }
}

function mapActionLogRow(row: ActionLogRow): ActionLogRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type,
    tier: row.tier,
    summary: row.summary,
    payload: row.payload,
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}
