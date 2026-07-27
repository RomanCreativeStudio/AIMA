import type { Queryable } from '../db/queryable';
import type { CapabilityRegistry } from './registry';

/**
 * Upserts every registered capability into the `capabilities` table, keyed
 * by `action_type`. The in-code `CapabilityRegistry` remains the single
 * source of truth for tier/lock defaults (docs/TECHNICAL_ARCHITECTURE.md
 * §5) — this just gives the database a stable row to reference as a
 * foreign key (e.g. `pending_approvals.capability_id`). Safe to call
 * repeatedly; it never deletes a capability that was removed from the
 * registry (docs/decisions/0004-intent-and-approval-engine.md).
 */
export async function syncCapabilitiesToDatabase(db: Queryable, registry: CapabilityRegistry): Promise<void> {
  for (const capability of registry.list()) {
    await db.query(
      `INSERT INTO capabilities (action_type, default_tier, tier_locked, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (action_type)
       DO UPDATE SET default_tier = EXCLUDED.default_tier,
                      tier_locked = EXCLUDED.tier_locked,
                      description = EXCLUDED.description`,
      [capability.actionType, capability.defaultTier, capability.tierLocked, capability.description],
    );
  }
}
