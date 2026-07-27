/**
 * The four states the Approval Engine supports (docs/PRODUCT_BIBLE.md §5,
 * docs/TECHNICAL_ARCHITECTURE.md §5). "no_approval_needed" covers Tier
 * 1/2/4 capabilities (nothing to approve); the other three track a
 * persisted `pending_approvals` row's lifecycle for a Tier 3 capability.
 */
export type ApprovalState = 'no_approval_needed' | 'approval_required' | 'approved' | 'denied';

export interface ApprovalDecision {
  state: ApprovalState;
  /** Present whenever a pending_approvals row exists — i.e. every state except 'no_approval_needed'. */
  pendingApprovalId?: string;
}
