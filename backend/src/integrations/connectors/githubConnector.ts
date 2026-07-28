import type { IntegrationCredentials } from '../types';
import type { ConnectionTestResult, GitHubConnector, IssueSummary, RepositorySummary } from './types';

const SAMPLE_REPOSITORIES: RepositorySummary[] = [
  { id: 'sample-repo-1', fullName: 'RomanCreativeStudio/AIMA', description: "AIMA's own monorepo.", isPrivate: true },
  { id: 'sample-repo-2', fullName: 'RomanCreativeStudio/mythic-forge-tools', description: 'Internal tooling.', isPrivate: true },
];

const SAMPLE_ISSUES: IssueSummary[] = [
  { id: 'sample-issue-1', number: 42, title: 'Fix flaky migration test', state: 'open' },
  { id: 'sample-issue-2', number: 41, title: 'Update onboarding docs', state: 'closed' },
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
}
