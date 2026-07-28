export const DRAFT_TYPES = ['email', 'proposal', 'client_response', 'report', 'github_issue'] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

/** The capability that gates creating each kind of draft (backend/src/permissions/registry.ts) — all Tier 2 "prepare". */
export const DRAFT_CAPABILITY_MAP: Record<DraftType, string> = {
  email: 'draft_email',
  proposal: 'draft_proposal',
  client_response: 'draft_client_response',
  report: 'draft_report',
  github_issue: 'draft_github_issue',
};

/**
 * The Action Preparation Layer's initial model (Phase 1.7): held content a
 * user reviews before anything is sent — deliberately just text + metadata,
 * no send/execute lifecycle yet (see docs/decisions/0007-intent-and-
 * approval-workflows.md).
 */
export interface Draft {
  id: string;
  workspaceId: string;
  type: DraftType;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDraftInput {
  workspaceId: string;
  type: DraftType;
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateDraftInput {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}
