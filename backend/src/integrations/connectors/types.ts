import type { IntegrationCredentials, IntegrationProvider } from '../types';

export interface ConnectionTestResult {
  ok: boolean;
  detail?: string;
}

/**
 * The connector provider abstraction (Phase 2.3, item 1) — mirrors
 * `ai-engine`'s `AIProvider`/`EmbeddingProvider` pattern: `IntegrationService`
 * depends only on this interface, never on a concrete Gmail/GitHub/Calendar
 * class. `testConnection` is the one capability every connector shares
 * (used by `IntegrationService.connect`/`rotate` to validate credentials
 * actually work before storing them) — read-only, never mutates anything
 * remote.
 */
export interface IntegrationConnector {
  readonly provider: IntegrationProvider;
  testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult>;
}

export interface EmailMessageSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
}

export interface SaveDraftInput {
  to: string;
  subject: string;
  body: string;
}

export interface SaveDraftResult {
  draftId: string;
}

export interface GmailConnector extends IntegrationConnector {
  listMessages(credentials: IntegrationCredentials, options?: { limit?: number }): Promise<EmailMessageSummary[]>;
  /** Phase 2.6 — sends an email through the connected Gmail account. Real write, Tier 3 (`send_email`). */
  sendEmail(credentials: IntegrationCredentials, input: SendEmailInput): Promise<SendEmailResult>;
  /** Phase 2.6 — saves a draft directly within the connected Gmail account. Real write, Tier 3 (`draft_gmail_email`), distinct from the local `draft_email` capability. */
  saveDraft(credentials: IntegrationCredentials, input: SaveDraftInput): Promise<SaveDraftResult>;
}

export interface RepositorySummary {
  id: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
}

export interface CreateIssueInput {
  repository: string;
  title: string;
  body: string;
}

export interface CreateIssueResult {
  issueId: string;
  number: number;
}

export interface CreatePullRequestInput {
  repository: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface CreatePullRequestResult {
  pullRequestId: string;
  number: number;
}

export interface GitHubConnector extends IntegrationConnector {
  listRepositories(credentials: IntegrationCredentials): Promise<RepositorySummary[]>;
  listIssues(credentials: IntegrationCredentials, repositoryFullName: string): Promise<IssueSummary[]>;
  /** Phase 2.6 — creates an issue directly on a connected repository. Real write, Tier 3 (`create_github_issue`), distinct from the local `draft_github_issue` capability. */
  createIssue(credentials: IntegrationCredentials, input: CreateIssueInput): Promise<CreateIssueResult>;
  /** Phase 2.6 — opens a pull request directly on a connected repository. Real write, Tier 3 (`create_github_pull_request`). */
  createPullRequest(credentials: IntegrationCredentials, input: CreatePullRequestInput): Promise<CreatePullRequestResult>;
}

export interface CalendarEventSummary {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface CalendarConnector extends IntegrationConnector {
  listEvents(credentials: IntegrationCredentials, options?: { from?: string; to?: string }): Promise<CalendarEventSummary[]>;
}
