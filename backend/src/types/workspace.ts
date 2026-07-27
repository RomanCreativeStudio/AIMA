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
