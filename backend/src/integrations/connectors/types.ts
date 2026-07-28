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
  /** "Read Inbox" (Phase 2.3/2.7) — the most recent messages, regardless of read state. */
  listMessages(credentials: IntegrationCredentials, options?: { limit?: number }): Promise<EmailMessageSummary[]>;
  /** "Read Unread" (Phase 2.7) — messages carrying Gmail's `UNREAD` label. */
  listUnreadMessages(credentials: IntegrationCredentials, options?: { limit?: number }): Promise<EmailMessageSummary[]>;
  /** "Search Messages" (Phase 2.7) — `query` is a raw Gmail search query (e.g. `from:client@example.com is:unread`). */
  searchMessages(credentials: IntegrationCredentials, query: string, options?: { limit?: number }): Promise<EmailMessageSummary[]>;
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

export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  head: string;
  base: string;
}

export interface GitHubConnector extends IntegrationConnector {
  listRepositories(credentials: IntegrationCredentials): Promise<RepositorySummary[]>;
  listIssues(credentials: IntegrationCredentials, repositoryFullName: string): Promise<IssueSummary[]>;
  /** "Read Pull Requests" (Phase 2.7). */
  listPullRequests(credentials: IntegrationCredentials, repositoryFullName: string): Promise<PullRequestSummary[]>;
  /** Phase 2.6 — creates an issue directly on a connected repository. Real write, Tier 3 (`create_github_issue`), distinct from the local `draft_github_issue` capability. */
  createIssue(credentials: IntegrationCredentials, input: CreateIssueInput): Promise<CreateIssueResult>;
  /** Phase 2.6 — opens a pull request directly on a connected repository. Real write, Tier 3 (`create_github_pull_request`). */
  createPullRequest(credentials: IntegrationCredentials, input: CreatePullRequestInput): Promise<CreatePullRequestResult>;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
}

export interface CalendarEventSummary {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface CreateEventInput {
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string;
}

export interface CreateEventResult {
  eventId: string;
}

export interface UpdateEventInput {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  description?: string;
}

export interface UpdateEventResult {
  eventId: string;
}

export interface CalendarConnector extends IntegrationConnector {
  /** "List Calendars" (Phase 2.7) — every calendar on the connected account, not just the primary one. */
  listCalendars(credentials: IntegrationCredentials): Promise<CalendarSummary[]>;
  listEvents(credentials: IntegrationCredentials, options?: { calendarId?: string; from?: string; to?: string }): Promise<CalendarEventSummary[]>;
  /** "Create Event" (Phase 2.7) — real write, Tier 3 (`create_calendar_event`). Defaults to the primary calendar if `calendarId` is omitted. */
  createEvent(credentials: IntegrationCredentials, input: CreateEventInput & { calendarId?: string }): Promise<CreateEventResult>;
  /** "Update Event" (Phase 2.7) — real write, Tier 3 (`update_calendar_event`). */
  updateEvent(credentials: IntegrationCredentials, eventId: string, input: UpdateEventInput & { calendarId?: string }): Promise<UpdateEventResult>;
  /** "Delete Event" (Phase 2.7) — real write, Tier 3 (`delete_calendar_event`). */
  deleteEvent(credentials: IntegrationCredentials, eventId: string, options?: { calendarId?: string }): Promise<void>;
}
