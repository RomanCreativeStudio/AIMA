/**
 * The lifecycle of a persisted `pending_approvals` row (docs/PRODUCT_BIBLE.md
 * §5, docs/TECHNICAL_ARCHITECTURE.md §5). "expired" is never written to the
 * database — it's derived from `expires_at` at read time (see
 * ApprovalEngine), so a row that's still 'pending' in the database but past
 * its expiry reports as 'expired' without needing a background job.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalDecision {
  /** 'no_approval_needed' when the capability's tier doesn't require approval at all; otherwise the real lifecycle status of the created/looked-up row. */
  state: 'no_approval_needed' | ApprovalStatus;
  /** Present whenever a pending_approvals row exists — i.e. whenever state isn't 'no_approval_needed'. */
  pendingApprovalId?: string;
}

/** A full pending_approvals row, as returned by list()/get(). */
export interface PendingApproval {
  id: string;
  workspaceId: string;
  actionType: string;
  payload: unknown;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}
