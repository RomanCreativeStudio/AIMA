import type { GitHubConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `create_github_issue` (Tier 3, tier-locked, new in Phase 2.6) — distinct from the local-only `draft_github_issue` capability. */
export class GitHubCreateIssueExecutor implements ActionExecutor {
  readonly actionType = 'create_github_issue';
  readonly provider = 'github' as const;

  constructor(private readonly connector: GitHubConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { repository, title, body } = context.payload;
    if (typeof repository !== 'string' || typeof title !== 'string') {
      throw new Error('payload.repository and payload.title are required strings');
    }
    if (body !== undefined && typeof body !== 'string') {
      throw new Error('payload.body must be a string if provided');
    }

    const result = await this.connector.createIssue(context.credentials, {
      repository,
      title,
      body: typeof body === 'string' ? body : '',
    });
    return { responseSummary: { issueId: result.issueId, number: result.number, repository, title } };
  }
}
