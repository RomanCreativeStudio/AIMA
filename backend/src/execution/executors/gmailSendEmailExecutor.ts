import type { GmailConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `send_email` (Tier 3, tier-locked since Phase 1.4) — its first real caller. */
export class GmailSendEmailExecutor implements ActionExecutor {
  readonly actionType = 'send_email';
  readonly provider = 'gmail' as const;

  constructor(private readonly connector: GmailConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { to, subject, body } = context.payload;
    if (typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') {
      throw new Error('payload.to, payload.subject, and payload.body must all be strings');
    }

    const result = await this.connector.sendEmail(context.credentials, { to, subject, body });
    return { responseSummary: { messageId: result.messageId, to, subject } };
  }
}
