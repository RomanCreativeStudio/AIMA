import type { WorkspaceSlug, WorkspaceType } from '../types/workspace';

/**
 * The Workspace Configuration System's model (Phase 1.8): `slug` remains
 * the fixed identity (docs/PRODUCT_BIBLE.md §1); everything else here is
 * configuration on top of it. `type` is always a real `WorkspaceType` on
 * this interface — WorkspaceService resolves a NULL database value to its
 * slug-based default (docs/decisions/0008-user-identity-and-workspace-
 * intelligence.md) so callers never have to.
 */
export interface Workspace {
  id: string;
  userId: string;
  slug: WorkspaceSlug;
  name: string;
  type: WorkspaceType;
  /** Free-text, workspace-specific guidance folded into the assistant's system prompt alongside the static per-slug default. */
  instructions: string | null;
  /** Structured behavior toggles (e.g. tone, verbosity) folded into the effective assistant profile. */
  assistantBehavior: Record<string, unknown>;
  /** Freeform catch-all (tags, external references, etc.) — not surfaced to the AI prompt. */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  userId: string;
  slug: WorkspaceSlug;
  name: string;
  /** Defaults to `WORKSPACE_TYPE_BY_SLUG[slug]` if omitted. */
  type?: WorkspaceType;
  instructions?: string;
  assistantBehavior?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkspaceInput {
  name?: string;
  type?: WorkspaceType;
  instructions?: string | null;
  assistantBehavior?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
