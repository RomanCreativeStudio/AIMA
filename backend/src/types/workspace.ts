/**
 * The four workspaces defined in docs/PRODUCT_BIBLE.md §1 and enforced
 * structurally per docs/TECHNICAL_ARCHITECTURE.md §6. This is the fixed set —
 * adding a workspace kind is a product decision, not a runtime configuration.
 */
export const WORKSPACE_SLUGS = ['personal', 'rcs', 'mfs', 'development'] as const;

export type WorkspaceSlug = (typeof WORKSPACE_SLUGS)[number];

export function isWorkspaceSlug(value: string): value is WorkspaceSlug {
  return (WORKSPACE_SLUGS as readonly string[]).includes(value);
}

/**
 * The generic behavioral category a workspace belongs to (Phase 1.8,
 * docs/decisions/0008-user-identity-and-workspace-intelligence.md) —
 * independent of `slug`, so a future non-fixed workspace could share a
 * type's default behavior without needing its own dedicated slug. Today's
 * four fixed slugs each map to exactly one type via
 * `WORKSPACE_TYPE_BY_SLUG`.
 */
export const WORKSPACE_TYPES = ['personal', 'business', 'creative', 'development'] as const;

export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export function isWorkspaceType(value: string): value is WorkspaceType {
  return (WORKSPACE_TYPES as readonly string[]).includes(value);
}

/** The default `type` for each fixed slug, used whenever a workspace row's `type` column is NULL. */
export const WORKSPACE_TYPE_BY_SLUG: Record<WorkspaceSlug, WorkspaceType> = {
  personal: 'personal',
  rcs: 'business',
  mfs: 'creative',
  development: 'development',
};
