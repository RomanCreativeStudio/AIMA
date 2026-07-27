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
}
