import type { IntegrationCredentials } from '../types';
import type { CalendarConnector, CalendarEventSummary, ConnectionTestResult } from './types';

const SAMPLE_EVENTS: CalendarEventSummary[] = [
  { id: 'sample-event-1', title: 'Client check-in — Acme', startsAt: '2026-07-28T15:00:00.000Z', endsAt: '2026-07-28T15:30:00.000Z' },
  { id: 'sample-event-2', title: 'MFS production review', startsAt: '2026-07-29T18:00:00.000Z', endsAt: '2026-07-29T19:00:00.000Z' },
];

/**
 * A read-only Calendar connector (Phase 2.3, item 2). Like the other two
 * connectors, this is a deterministic stub, not a live client — a real
 * implementation would call a calendar provider's API (e.g. Google
 * Calendar's `GET /calendars/primary/events`) with an OAuth2 token, but
 * this phase ships only the connector's shape (docs/decisions/0011-
 * external-integrations-foundation.md).
 */
export class StubCalendarConnector implements CalendarConnector {
  readonly provider = 'calendar' as const;

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken || !credentials.refreshToken) {
      return { ok: false, detail: 'accessToken and refreshToken are both required' };
    }
    return { ok: true };
  }

  async listEvents(
    credentials: IntegrationCredentials,
    options: { from?: string; to?: string } = {},
  ): Promise<CalendarEventSummary[]> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot list events: ${result.detail}`);
    }
    if (!options.from && !options.to) {
      return SAMPLE_EVENTS;
    }
    return SAMPLE_EVENTS.filter((event) => {
      if (options.from && event.startsAt < options.from) return false;
      if (options.to && event.startsAt > options.to) return false;
      return true;
    });
  }
}
