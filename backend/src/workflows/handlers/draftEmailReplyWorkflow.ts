import type { AIProvider } from '@aima/ai-engine';
import type { DraftService } from '../../drafts/draftService';
import type { WorkflowDefinition } from '../types';
import type { WorkflowHandler, WorkflowStepContext } from './types';

/**
 * "Draft Email Reply" (Phase 2.4, item 2): compose reply text, then save it
 * to the local draft queue. Both steps are Tier 1/2 — neither ever touches
 * anything outside AIMA, so neither pauses for approval.
 */
export class DraftEmailReplyWorkflowHandler implements WorkflowHandler {
  constructor(
    readonly definition: WorkflowDefinition,
    private readonly aiProvider: AIProvider,
    private readonly draftService: DraftService,
  ) {}

  async executeStep(stepIndex: number, context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const step = this.definition.steps[stepIndex];
    switch (step?.key) {
      case 'compose_reply':
        return this.composeReply(context);
      case 'save_draft':
        return this.saveDraft(context);
      default:
        throw new Error(`Unknown step index ${stepIndex} for workflow "${this.definition.key}"`);
    }
  }

  private async composeReply(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const topic = context.input.topic || 'the message';
    const recipientName = context.input.recipientName;
    const notes = context.input.notes ?? '';
    const prompt =
      `Draft a concise, professional email reply${recipientName ? ` to ${recipientName}` : ''} about ${topic}. ${notes}`.trim();

    const completion = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'You draft email replies. Reply with the email body only, no commentary.',
    });

    return { subject: `Re: ${topic}`, body: completion.content };
  }

  private async saveDraft(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const composed = context.priorOutputs.compose_reply ?? {};
    const subject = typeof composed.subject === 'string' ? composed.subject : 'Draft reply';
    const body = typeof composed.body === 'string' ? composed.body : '';

    const draft = await this.draftService.createDraft({
      workspaceId: context.workspaceId,
      type: 'email',
      title: subject,
      content: body,
    });

    return { draftId: draft.id };
  }
}
