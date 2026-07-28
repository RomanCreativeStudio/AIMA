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

const BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';

interface GitHubRepositoryResource {
  id: number;
  full_name: string;
  description: string | null;
  private: boolean;
}

interface GitHubIssueResource {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  pull_request?: unknown;
}

interface GitHubPullRequestResource {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  head: { ref: string };
  base: { ref: string };
}

interface GitHubCreateIssueResponse {
  id: number;
  number: number;
}

interface GitHubCreatePullRequestResponse {
  id: number;
  number: number;
}

/**
 * The real GitHub connector (Phase 2.7, item 2) — calls the GitHub REST API
 * directly via `fetch`, same "no SDK for one endpoint" reasoning as
 * `GoogleGmailConnector`. GitHub's `issues` endpoint also returns pull
 * requests (a PR is an issue under the hood); `listIssues` filters those out
 * so it only ever returns true issues, matching what "Read Issues" means to
 * a caller expecting `IssueSummary[]`.
 */
export class LiveGitHubConnector implements GitHubConnector {
  readonly provider = 'github' as const;

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken) {
      return { ok: false, detail: 'accessToken is required' };
    }
    const response = await this.fetchFn(`${BASE_URL}/user`, { headers: this.authHeaders(credentials) });
    if (!response.ok) {
      return { ok: false, detail: await describeError(response) };
    }
    return { ok: true };
  }

  async listRepositories(credentials: IntegrationCredentials): Promise<RepositorySummary[]> {
    const response = await this.fetchFn(`${BASE_URL}/user/repos?per_page=100`, { headers: this.authHeaders(credentials) });
    if (!response.ok) {
      throw new Error(`GitHub listRepositories failed: ${await describeError(response)}`);
    }
    const repositories = (await response.json()) as GitHubRepositoryResource[];
    return repositories.map((repo) => ({
      id: String(repo.id),
      fullName: repo.full_name,
      description: repo.description,
      isPrivate: repo.private,
    }));
  }

  async listIssues(credentials: IntegrationCredentials, repositoryFullName: string): Promise<IssueSummary[]> {
    const { owner, repo } = parseRepository(repositoryFullName);
    const response = await this.fetchFn(`${BASE_URL}/repos/${owner}/${repo}/issues?state=all`, {
      headers: this.authHeaders(credentials),
    });
    if (!response.ok) {
      throw new Error(`GitHub listIssues failed: ${await describeError(response)}`);
    }
    const issues = (await response.json()) as GitHubIssueResource[];
    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({ id: String(issue.id), number: issue.number, title: issue.title, state: issue.state }));
  }

  async listPullRequests(credentials: IntegrationCredentials, repositoryFullName: string): Promise<PullRequestSummary[]> {
    const { owner, repo } = parseRepository(repositoryFullName);
    const response = await this.fetchFn(`${BASE_URL}/repos/${owner}/${repo}/pulls?state=all`, {
      headers: this.authHeaders(credentials),
    });
    if (!response.ok) {
      throw new Error(`GitHub listPullRequests failed: ${await describeError(response)}`);
    }
    const pullRequests = (await response.json()) as GitHubPullRequestResource[];
    return pullRequests.map((pullRequest) => ({
      id: String(pullRequest.id),
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      head: pullRequest.head.ref,
      base: pullRequest.base.ref,
    }));
  }

  async createIssue(credentials: IntegrationCredentials, input: CreateIssueInput): Promise<CreateIssueResult> {
    const { owner, repo } = parseRepository(input.repository);
    const response = await this.fetchFn(`${BASE_URL}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    if (!response.ok) {
      throw new Error(`GitHub createIssue failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GitHubCreateIssueResponse;
    return { issueId: String(body.id), number: body.number };
  }

  async createPullRequest(credentials: IntegrationCredentials, input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    const { owner, repo } = parseRepository(input.repository);
    const response = await this.fetchFn(`${BASE_URL}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
    });
    if (!response.ok) {
      throw new Error(`GitHub createPullRequest failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GitHubCreatePullRequestResponse;
    return { pullRequestId: String(body.id), number: body.number };
  }

  private authHeaders(credentials: IntegrationCredentials): Record<string, string> {
    return {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
  }
}

function parseRepository(repositoryFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repositoryFullName.split('/');
  if (!owner || !repo) {
    throw new Error(`repository must be in "owner/repo" form, got "${repositoryFullName}"`);
  }
  return { owner, repo };
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text();
  return `HTTP ${response.status}${text ? `: ${text}` : ''}`;
}
