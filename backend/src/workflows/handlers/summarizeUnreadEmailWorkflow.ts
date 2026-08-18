import type { AIProvider } from '@aima/ai-engine';
import type { GmailConnector, EmailMessageSummary } from '../../integrations/connectors/types';
import type { IntegrationService } from '../../integrations/integrationService';
import type { WorkflowDefinition } from '../types';
import type { WorkflowHandler, WorkflowStepContext } from './types';

/**
 * "Summarize Unread Email" (Phase 2.4, item 2): the one built-in workflow
 * with a genuinely approval-gated step. `read_unread_email` is capability-
 * gated by `read_email` (Tier 3, tier-locked since Phase 2.3) — this
 * handler's `executeStep` is only ever called for that step *after*
 * `WorkflowService` has confirmed the approval was granted, never before.
 * It's also the first real caller of `IntegrationService.
 * getDecryptedCredentials` and a connector's read method — both existed
 * since Phase 2.3 with nothing invoking them yet (docs/decisions/
 * 0011-external-integrations-foundation.md's consequences).
 */
export class SummarizeUnreadEmailWorkflowHandler implements WorkflowHandler {
  constructor(
    readonly definition: WorkflowDefinition,
    private readonly aiProvider: AIProvider,
    private readonly integrationService: IntegrationService,
    private readonly gmailConnector: GmailConnector,
  ) {}

  async executeStep(stepIndex: number, context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const step = this.definition.steps[stepIndex];
    switch (step?.key) {
      case 'read_unread_email':
        return this.readUnreadEmail(context);
      case 'summarize':
        return this.summarize(context);
      default:
        throw new Error(`Unknown step index ${stepIndex} for workflow "${this.definition.key}"`);
    }
  }

  private async readUnreadEmail(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const credentials = await this.integrationService.getDecryptedCredentials(context.workspaceId, 'gmail');
    const limit = Number.parseInt(context.input.limit ?? '5', 10);
    const messages = await this.gmailConnector.listMessages(credentials, { limit: Number.isFinite(limit) ? limit : 5 });
    return { messages };
  }

  private async summarize(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const priorOutput = context.priorOutputs.read_unread_email ?? {};
    const messages = (priorOutput.messages as EmailMessageSummary[] | undefined) ?? [];
    const digest = messages.map((message) => `From ${message.from}: ${message.subject} — ${message.snippet}`).join('\n');

    const completion = await this.aiProvider.complete({
      messages: [{ role: 'user', content: digest || 'No messages to summarize.' }],
      systemPrompt: 'You summarize a list of emails in a few sentences.',
    });

    return { summary: completion.content, messageCount: messages.length };
  }
}
