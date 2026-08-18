import type { GitHubConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `create_github_pull_request` (Tier 3, tier-locked, new in Phase 2.6). */
export class GitHubCreatePullRequestExecutor implements ActionExecutor {
  readonly actionType = 'create_github_pull_request';
  readonly provider = 'github' as const;

  constructor(private readonly connector: GitHubConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { repository, title, body, head, base } = context.payload;
    if (
      typeof repository !== 'string' ||
      typeof title !== 'string' ||
      typeof head !== 'string' ||
      typeof base !== 'string'
    ) {
      throw new Error('payload.repository, payload.title, payload.head, and payload.base are required strings');
    }
    if (body !== undefined && typeof body !== 'string') {
      throw new Error('payload.body must be a string if provided');
    }

    const result = await this.connector.createPullRequest(context.credentials, {
      repository,
      title,
      body: typeof body === 'string' ? body : '',
      head,
      base,
    });
    return { responseSummary: { pullRequestId: result.pullRequestId, number: result.number, repository, title } };
  }
}
