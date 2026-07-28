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

export interface GmailConnector extends IntegrationConnector {
  listMessages(credentials: IntegrationCredentials, options?: { limit?: number }): Promise<EmailMessageSummary[]>;
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

export interface GitHubConnector extends IntegrationConnector {
  listRepositories(credentials: IntegrationCredentials): Promise<RepositorySummary[]>;
  listIssues(credentials: IntegrationCredentials, repositoryFullName: string): Promise<IssueSummary[]>;
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
