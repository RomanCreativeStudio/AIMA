/**
 * The four permission tiers defined in docs/PRODUCT_BIBLE.md §5 and enforced
 * technically per docs/TECHNICAL_ARCHITECTURE.md §5.
 */
export type PermissionTier = 'suggest' | 'prepare' | 'execute_with_approval' | 'automatic_safe';

export interface CapabilityDefinition {
  /** Stable machine identifier, e.g. "send_email". Matches database.capabilities.action_type. */
  actionType: string;
  defaultTier: PermissionTier;
  /**
   * When true, this capability can never be promoted beyond "execute_with_approval" —
   * reserved for external communication, financial actions, and deletions
   * (docs/PRODUCT_BIBLE.md §5).
   */
  tierLocked: boolean;
  description: string;
}
