import type { Intent } from '@aima/ai-engine';

/**
 * Whether the detected intent's mapped capability WOULD require approval if
 * acted on, purely advisory — derived from the capability's current tier,
 * never from a real pending_approvals row. Deliberately a separate, smaller
 * type from `approval/types.ts`'s `ApprovalStatus` (pending/approved/
 * rejected/expired), which tracks the lifecycle of an actual approval
 * request. `AimaCoreService` is the one that turns this advisory flag into
 * a real `ApprovalDecision` by calling `ApprovalEngine` (docs/decisions/
 * 0007-intent-and-approval-workflows.md).
 */
export type ApprovalRequirement = 'no_approval_needed' | 'approval_required';

/**
 * The structured metadata attached to every conversation response
 * (docs/TECHNICAL_ARCHITECTURE.md §4, Response Schema).
 */
export interface IntentAnalysis {
  intent: Intent;
  confidence: number;
  /** Best-effort slot values extracted by the classifier (e.g. { title: "..." } for create_task). */
  parameters: Record<string, string>;
  approval: ApprovalRequirement;
  suggestedNextAction: string;
}
