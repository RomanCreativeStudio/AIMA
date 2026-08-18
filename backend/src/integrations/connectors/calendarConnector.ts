import { randomUUID } from 'node:crypto';
import type { IntegrationCredentials } from '../types';
import type {
  CalendarConnector,
  CalendarEventSummary,
  CalendarSummary,
  ConnectionTestResult,
  CreateEventInput,
  CreateEventResult,
  UpdateEventInput,
  UpdateEventResult,
} from './types';

const SAMPLE_CALENDARS: CalendarSummary[] = [{ id: 'primary', summary: 'Primary calendar', primary: true }];

const SAMPLE_EVENTS: CalendarEventSummary[] = [
  { id: 'sample-event-1', title: 'Client check-in — Acme', startsAt: '2026-07-28T15:00:00.000Z', endsAt: '2026-07-28T15:30:00.000Z' },
  { id: 'sample-event-2', title: 'MFS production review', startsAt: '2026-07-29T18:00:00.000Z', endsAt: '2026-07-29T19:00:00.000Z' },
];

/**
 * A deterministic stub Calendar connector (Phase 2.3, item 2; extended
 * Phase 2.7). Not a live client — kept alongside `GoogleCalendarConnector`
 * for tests and any caller that wants the connector's shape without a real
 * Google Calendar account (docs/decisions/0011-external-integrations-
 * foundation.md, docs/decisions/0015-live-integration-providers.md).
 */
export class StubCalendarConnector implements CalendarConnector {
  readonly provider = 'calendar' as const;

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken || !credentials.refreshToken) {
      return { ok: false, detail: 'accessToken and refreshToken are both required' };
    }
    return { ok: true };
  }

  async listCalendars(credentials: IntegrationCredentials): Promise<CalendarSummary[]> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot list calendars: ${result.detail}`);
    }
    return SAMPLE_CALENDARS;
  }

  async listEvents(
    credentials: IntegrationCredentials,
    options: { calendarId?: string; from?: string; to?: string } = {},
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

  /** Phase 2.7 — deterministic stub for "Create Event": real write, Tier 3 (`create_calendar_event`). */
  async createEvent(credentials: IntegrationCredentials, input: CreateEventInput & { calendarId?: string }): Promise<CreateEventResult> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot create event: ${result.detail}`);
    }
    if (!input.title || !input.startsAt || !input.endsAt) {
      throw new Error('title, startsAt, and endsAt are all required to create an event');
    }
    return { eventId: `mock-event-${randomUUID()}` };
  }

  /** Phase 2.7 — deterministic stub for "Update Event": real write, Tier 3 (`update_calendar_event`). */
  async updateEvent(
    credentials: IntegrationCredentials,
    eventId: string,
    input: UpdateEventInput & { calendarId?: string },
  ): Promise<UpdateEventResult> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot update event: ${result.detail}`);
    }
    if (!eventId) {
      throw new Error('eventId is required to update an event');
    }
    if (input.title === undefined && input.startsAt === undefined && input.endsAt === undefined && input.description === undefined) {
      throw new Error('at least one field must be provided to update an event');
    }
    return { eventId };
  }

  /** Phase 2.7 — deterministic stub for "Delete Event": real write, Tier 3 (`delete_calendar_event`). */
  async deleteEvent(credentials: IntegrationCredentials, eventId: string): Promise<void> {
    const result = await this.testConnection(credentials);
    if (!result.ok) {
      throw new Error(`Cannot delete event: ${result.detail}`);
    }
    if (!eventId) {
      throw new Error('eventId is required to delete an event');
    }
  }
}
