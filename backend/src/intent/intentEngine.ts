import type { IntentClassifier } from '@aima/ai-engine';
import type { PermissionDecision, PermissionEngine } from '../permissions/engine';
import { INTENT_CAPABILITY_MAP, SUGGESTED_NEXT_ACTIONS } from './intentCapabilityMap';
import type { ApprovalRequirement, IntentAnalysis } from './types';

/**
 * Composes intent classification with the Permission Engine to produce
 * response metadata (docs/TECHNICAL_ARCHITECTURE.md §4, Conversation
 * Integration). Purely advisory: never writes to the database, never
 * creates a pending approval, never executes anything — it only reports
 * what tier/approval the detected intent's capability would require if
 * acted on. Actually creating/resolving an approval is the separate,
 * DB-backed ApprovalEngine (backend/src/approval/).
 */
export class IntentEngine {
  constructor(
    private readonly classifier: IntentClassifier,
    private readonly permissionEngine: PermissionEngine,
  ) {}

  async analyze(message: string): Promise<IntentAnalysis> {
    const { intent, confidence, parameters } = await this.classifier.classify(message);
    const capability = INTENT_CAPABILITY_MAP[intent];

    const approval: ApprovalRequirement = capability
      ? mapDecisionToApproval(this.permissionEngine.evaluate(capability))
      : 'no_approval_needed';

    return {
      intent,
      confidence,
      parameters,
      approval,
      suggestedNextAction: SUGGESTED_NEXT_ACTIONS[intent],
    };
  }
}

function mapDecisionToApproval(decision: PermissionDecision): ApprovalRequirement {
  return decision.kind === 'requires_approval' ? 'approval_required' : 'no_approval_needed';
}
