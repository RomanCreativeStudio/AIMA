import type { GmailConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `draft_gmail_email` (Tier 3, tier-locked since Phase 2.3) — its first real caller. Distinct from the local-only `draft_email` capability. */
export class GmailSaveDraftExecutor implements ActionExecutor {
  readonly actionType = 'draft_gmail_email';
  readonly provider = 'gmail' as const;

  constructor(private readonly connector: GmailConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { to, subject, body } = context.payload;
    if (typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') {
      throw new Error('payload.to, payload.subject, and payload.body must all be strings');
    }

    const result = await this.connector.saveDraft(context.credentials, { to, subject, body });
    return { responseSummary: { draftId: result.draftId, to, subject } };
  }
}
