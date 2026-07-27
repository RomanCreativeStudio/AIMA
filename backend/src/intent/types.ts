import type { Intent } from '@aima/ai-engine';
import type { ApprovalState } from '../approval/types';

/**
 * The structured metadata attached to every conversation response
 * (docs/TECHNICAL_ARCHITECTURE.md §4, Response Schema). `approval` here is
 * always 'no_approval_needed' or 'approval_required' — it reports what tier
 * the detected intent's capability WOULD require, without creating a
 * pending approval or executing anything.
 */
export interface IntentAnalysis {
  intent: Intent;
  confidence: number;
  approval: ApprovalState;
  suggestedNextAction: string;
}
