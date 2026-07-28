import { randomUUID } from 'node:crypto';
import type { IntegrationCredentials } from '../types';
import type {
  ConnectionTestResult,
  CreateIssueInput,
  CreateIssueResult,
  CreatePullRequestInput,
  CreatePullRequestResult,
  GitHubConnector,
  IssueSummary,
  PullRequestSummary,
  RepositorySummary,
} from './types';

const SAMPLE_REPOSITORIES: RepositorySummary[] = [
  { id: 'sample-repo-1', fullName: 'RomanCreativeStudio/AIMA', description: "AIMA's own monorepo.", isPrivate: true },
  { id: 'sample-repo-2', fullName: 'RomanCreativeStudio/mythic-forge-tools', description: 'Internal tooling.', isPrivate: true },
];

const SAMPLE_ISSUES: IssueSummary[] = [
  { id: 'sample-issue-1', number: 42, title: 'Fix flaky migration test', state: 'open' },
  { id: 'sample-issue-2', number: 41, title: 'Update onboarding docs', state: 'closed' },
];

const SAMPLE_PULL_REQUESTS: PullRequestSummary[] = [
  { id: 'sample-pr-1', number: 17, title: 'Add Phase 2.6 execution foundation', state: 'open', head: 'feature/execution', base: 'main' },
  { id: 'sample-pr-2', number: 16, title: 'Fix flaky migration test', state: 'closed', head: 'fix/migration', base: 'main' },
];

/**
 * A read-only GitHub connector (Phase 2.3, item 2). Like `StubGmailConnector`,
 * this is a deterministic stub, not a live client — a real implementation
 * would call the GitHub REST API (`GET /user/repos`, `GET /repos/:owner/
 * :repo/issues`) with a personal access token or OAuth token, but this phase
 * ships only the connector's shape (docs/decisions/0011-external-
 * integrations-foundation.md).
 */
export class StubGitHubConnector implements GitHubConnector {
  readonly provider = 'github' as const;

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken) {
      return { ok: false, detail: 'accessToken is required' };
    }
    return { ok: true };
  }

  async listRepositories(credentials: IntegrationCredentials): Promise<RepositorySummary[]> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot list repositories: ${result.detail}`);
    }
    return SAMPLE_REPOSITORIES;
  }

  async listIssues(credentials: IntegrationCredentials, repositoryFullName: string): Promise<IssueSummary[]> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot list issues: ${result.detail}`);
    }
    if (!SAMPLE_REPOSITORIES.some((repo) => repo.fullName === repositoryFullName)) {
      return [];
    }
    return SAMPLE_ISSUES;
  }

  /** Phase 2.7 — deterministic stub for "Read Pull Requests". */
  async listPullRequests(credentials: IntegrationCredentials, repositoryFullName: string): Promise<PullRequestSummary[]> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot list pull requests: ${result.detail}`);
    }
    if (!SAMPLE_REPOSITORIES.some((repo) => repo.fullName === repositoryFullName)) {
      return [];
    }
    return SAMPLE_PULL_REQUESTS;
  }

  /**
   * Phase 2.6 — deterministic stub for `create_github_issue`: a real
   * implementation would call `POST /repos/:owner/:repo/issues`; this
   * validates credentials and input, returning a synthesized issue number,
   * with no network call (docs/decisions/0014-action-execution-foundation.md).
   * Distinct from `draft_github_issue` (Phase 2.4), which only ever writes
   * to AIMA's own local drafts table.
   */
  async createIssue(credentials: IntegrationCredentials, input: CreateIssueInput): Promise<CreateIssueResult> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot create issue: ${result.detail}`);
    }
    if (!input.repository || !input.title) {
      throw new Error('repository and title are required to create an issue');
    }
    return { issueId: `mock-issue-${randomUUID()}`, number: 1000 + SAMPLE_ISSUES.length };
  }

  /** Phase 2.6 — deterministic stub for `create_github_pull_request`: a real implementation would call `POST /repos/:owner/:repo/pulls`. */
  async createPullRequest(credentials: IntegrationCredentials, input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot create pull request: ${result.detail}`);
    }
    if (!input.repository || !input.title || !input.head || !input.base) {
      throw new Error('repository, title, head, and base are all required to create a pull request');
    }
    return { pullRequestId: `mock-pr-${randomUUID()}`, number: 2000 + SAMPLE_ISSUES.length };
  }
}
