import type { IntegrationCredentials } from '../types';
import type {
  ConnectionTestResult,
  EmailMessageSummary,
  GmailConnector,
  SaveDraftInput,
  SaveDraftResult,
  SendEmailInput,
  SendEmailResult,
} from './types';

const BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailMessageListResponse {
  messages?: Array<{ id: string }>;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageResource {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

interface GmailSendResponse {
  id: string;
}

interface GmailDraftResponse {
  id: string;
}

/**
 * The real Gmail connector (Phase 2.7, item 1) — calls the Gmail REST API
 * directly via `fetch` rather than Google's Node client library, mirroring
 * `OpenAIEmbeddingProvider`'s "one endpoint doesn't need a whole SDK"
 * precedent (`ai-engine/src/embeddings/OpenAIEmbeddingProvider.ts`). `fetch`
 * is injectable (defaults to the global implementation) so tests can
 * substitute a fake one — no live network call happens in this repo's test
 * suite (docs/decisions/0015-live-integration-providers.md).
 *
 * Listing messages is two round trips, matching the real API's own shape:
 * Gmail's `messages.list` returns bare `{id}` pairs with no content, so each
 * summary requires a follow-up `messages.get` in metadata-only format.
 */
export class GoogleGmailConnector implements GmailConnector {
  readonly provider = 'gmail' as const;

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken) {
      return { ok: false, detail: 'accessToken is required' };
    }
    const response = await this.fetchFn(`${BASE_URL}/profile`, { headers: this.authHeaders(credentials) });
    if (!response.ok) {
      return { ok: false, detail: await describeError(response) };
    }
    return { ok: true };
  }

  async listMessages(credentials: IntegrationCredentials, options: { limit?: number } = {}): Promise<EmailMessageSummary[]> {
    return this.listAndSummarize(credentials, { labelIds: 'INBOX' }, options.limit);
  }

  async listUnreadMessages(credentials: IntegrationCredentials, options: { limit?: number } = {}): Promise<EmailMessageSummary[]> {
    return this.listAndSummarize(credentials, { q: 'is:unread' }, options.limit);
  }

  async searchMessages(credentials: IntegrationCredentials, query: string, options: { limit?: number } = {}): Promise<EmailMessageSummary[]> {
    return this.listAndSummarize(credentials, { q: query }, options.limit);
  }

  async sendEmail(credentials: IntegrationCredentials, input: SendEmailInput): Promise<SendEmailResult> {
    const raw = buildRawMessage(input.to, input.subject, input.body);
    const response = await this.fetchFn(`${BASE_URL}/messages/send`, {
      method: 'POST',
      headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) {
      throw new Error(`Gmail sendEmail failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GmailSendResponse;
    return { messageId: body.id };
  }

  async saveDraft(credentials: IntegrationCredentials, input: SaveDraftInput): Promise<SaveDraftResult> {
    const raw = buildRawMessage(input.to, input.subject, input.body);
    const response = await this.fetchFn(`${BASE_URL}/drafts`, {
      method: 'POST',
      headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!response.ok) {
      throw new Error(`Gmail saveDraft failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GmailDraftResponse;
    return { draftId: body.id };
  }

  private async listAndSummarize(
    credentials: IntegrationCredentials,
    query: Record<string, string>,
    limit?: number,
  ): Promise<EmailMessageSummary[]> {
    const params = new URLSearchParams({ ...query, maxResults: String(limit ?? 20) });
    const listResponse = await this.fetchFn(`${BASE_URL}/messages?${params.toString()}`, {
      headers: this.authHeaders(credentials),
    });
    if (!listResponse.ok) {
      throw new Error(`Gmail message list failed: ${await describeError(listResponse)}`);
    }
    const list = (await listResponse.json()) as GmailMessageListResponse;
    const ids = (list.messages ?? []).slice(0, limit ?? undefined);

    const summaries = await Promise.all(
      ids.map(async ({ id }) => {
        const messageParams = new URLSearchParams({
          format: 'metadata',
          metadataHeaders: 'From',
        });
        messageParams.append('metadataHeaders', 'Subject');
        const messageResponse = await this.fetchFn(`${BASE_URL}/messages/${id}?${messageParams.toString()}`, {
          headers: this.authHeaders(credentials),
        });
        if (!messageResponse.ok) {
          throw new Error(`Gmail message fetch failed: ${await describeError(messageResponse)}`);
        }
        const message = (await messageResponse.json()) as GmailMessageResource;
        return toSummary(message);
      }),
    );
    return summaries;
  }

  private authHeaders(credentials: IntegrationCredentials): Record<string, string> {
    return { Authorization: `Bearer ${credentials.accessToken}` };
  }
}

function toSummary(message: GmailMessageResource): EmailMessageSummary {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) => headers.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return {
    id: message.id,
    from: header('From'),
    subject: header('Subject'),
    snippet: message.snippet ?? '',
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '',
  };
}

/** Builds a base64url-encoded RFC 2822 message — the `raw` field Gmail's `messages.send`/`drafts.create` both require. */
function buildRawMessage(to: string, subject: string, body: string): string {
  const message = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text();
  return `HTTP ${response.status}${text ? `: ${text}` : ''}`;
}
