import type { AIProvider } from '@aima/ai-engine';
import type { DraftService } from '../../drafts/draftService';
import type { WorkflowDefinition } from '../types';
import type { WorkflowHandler, WorkflowStepContext } from './types';

/**
 * "Create GitHub Issue Draft" (Phase 2.4, item 2): compose an issue title
 * and body, then save it to the local draft queue as a `github_issue`
 * draft (`database/migrations/0012_workflows.sql`'s `draft_type`
 * extension). Never creates anything on GitHub — the read-only GitHub
 * integration (Phase 2.3) has no write capability, by design.
 */
export class CreateGithubIssueDraftWorkflowHandler implements WorkflowHandler {
  constructor(
    readonly definition: WorkflowDefinition,
    private readonly aiProvider: AIProvider,
    private readonly draftService: DraftService,
  ) {}

  async executeStep(stepIndex: number, context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const step = this.definition.steps[stepIndex];
    switch (step?.key) {
      case 'compose_issue':
        return this.composeIssue(context);
      case 'save_draft':
        return this.saveDraft(context);
      default:
        throw new Error(`Unknown step index ${stepIndex} for workflow "${this.definition.key}"`);
    }
  }

  private async composeIssue(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const repository = context.input.repository || 'the repository';
    const summary = context.input.summary ?? '';
    const prompt = `Draft a clear GitHub issue body for ${repository} describing: ${summary}`;

    const completion = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'You draft GitHub issues. Reply with the issue body only, no commentary.',
    });

    return { title: summary ? `Issue: ${summary}` : `Issue for ${repository}`, body: completion.content, repository };
  }

  private async saveDraft(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const composed = context.priorOutputs.compose_issue ?? {};
    const title = typeof composed.title === 'string' ? composed.title : 'Draft issue';
    const body = typeof composed.body === 'string' ? composed.body : '';
    const repository = typeof composed.repository === 'string' ? composed.repository : undefined;

    const draft = await this.draftService.createDraft({
      workspaceId: context.workspaceId,
      type: 'github_issue',
      title,
      content: body,
      metadata: repository ? { repository } : {},
    });

    return { draftId: draft.id };
  }
}
