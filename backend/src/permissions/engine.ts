import type { CapabilityRegistry } from './registry';
import type { PermissionTier } from './types';

export type PermissionDecision =
  | { kind: 'suggest' }
  | { kind: 'prepare' }
  | { kind: 'requires_approval' }
  | { kind: 'auto_execute' };

/**
 * Deterministic backend gate every action-producing code path must pass
 * through (docs/TECHNICAL_ARCHITECTURE.md §5). The AI model proposes an
 * intent; this engine — not the model — decides whether it is shown as a
 * suggestion, held as a draft, queued for approval, or executed.
 */
export class PermissionEngine {
  constructor(private readonly registry: CapabilityRegistry) {}

  resolveTier(actionType: string): PermissionTier {
    const capability = this.registry.get(actionType);
    if (!capability) {
      throw new Error(
        `Unregistered capability: "${actionType}". Every capability must be declared in the ` +
          'CapabilityRegistry with a permission tier before it can be used (docs/TECHNICAL_ARCHITECTURE.md §5).',
      );
    }

    // Per-workspace tier promotion (backed by the workspace_capability_settings
    // table) is not wired in yet — this returns the capability's registered
    // default tier. Overrides land in the Integration Sprint alongside
    // workspace CRUD and auth (docs/TECHNICAL_ARCHITECTURE.md §10).
    return capability.defaultTier;
  }

  evaluate(actionType: string): PermissionDecision {
    const tier = this.resolveTier(actionType);

    switch (tier) {
      case 'suggest':
        return { kind: 'suggest' };
      case 'prepare':
        return { kind: 'prepare' };
      case 'execute_with_approval':
        return { kind: 'requires_approval' };
      case 'automatic_safe':
        return { kind: 'auto_execute' };
    }
  }
}
