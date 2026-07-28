import type { IntegrationCredentials } from '../types';
import type { ConnectionTestResult, EmailMessageSummary, GmailConnector } from './types';

const SAMPLE_MESSAGES: EmailMessageSummary[] = [
  {
    id: 'sample-msg-1',
    from: 'client@example.com',
    subject: 'Re: Project timeline',
    snippet: 'Thanks for the update — can we confirm the revised delivery date?',
    receivedAt: '2026-07-20T14:30:00.000Z',
  },
  {
    id: 'sample-msg-2',
    from: 'billing@vendor.example.com',
    subject: 'Invoice #4821',
    snippet: 'Your invoice for last month is now available.',
    receivedAt: '2026-07-18T09:05:00.000Z',
  },
];

/**
 * A read-only Gmail connector (Phase 2.3, item 2). This is a deterministic
 * stub, not a live client: a real implementation would call the Gmail API
 * (`GET https://gmail.googleapis.com/gmail/v1/users/me/messages`) with an
 * OAuth2 access token, but registering a real Google OAuth app and obtaining
 * a user's consent is outside what this environment can do, so this phase
 * ships the connector's *shape* — the interface, credential validation, and
 * a caller-testable contract — rather than a live network call
 * (docs/decisions/0011-external-integrations-foundation.md).
 */
export class StubGmailConnector implements GmailConnector {
  readonly provider = 'gmail' as const;

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken || !credentials.refreshToken) {
      return { ok: false, detail: 'accessToken and refreshToken are both required' };
    }
    return { ok: true };
  }

  async listMessages(
    credentials: IntegrationCredentials,
    options: { limit?: number } = {},
  ): Promise<EmailMessageSummary[]> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot list messages: ${result.detail}`);
    }
    return SAMPLE_MESSAGES.slice(0, options.limit ?? SAMPLE_MESSAGES.length);
  }
}
