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

const BASE_URL = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_CALENDAR_ID = 'primary';

interface GoogleCalendarListResponse {
  items?: Array<{ id: string; summary: string; primary?: boolean }>;
}

interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
}

interface GoogleEventResource {
  id: string;
  summary?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
}

interface GoogleEventListResponse {
  items?: GoogleEventResource[];
}

/**
 * The real Google Calendar connector (Phase 2.7, item 3) — calls the
 * Calendar API directly via `fetch`, same reasoning as `GoogleGmailConnector`.
 * Every write (`createEvent`/`updateEvent`/`deleteEvent`) defaults to the
 * `primary` calendar when `calendarId` is omitted, since most workspaces
 * only ever act on their one primary calendar and "List Calendars" exists
 * precisely for the cases that need to target a different one.
 */
export class GoogleCalendarConnector implements CalendarConnector {
  readonly provider = 'calendar' as const;

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    if (!credentials.accessToken) {
      return { ok: false, detail: 'accessToken is required' };
    }
    const response = await this.fetchFn(`${BASE_URL}/calendars/${DEFAULT_CALENDAR_ID}`, { headers: this.authHeaders(credentials) });
    if (!response.ok) {
      return { ok: false, detail: await describeError(response) };
    }
    return { ok: true };
  }

  async listCalendars(credentials: IntegrationCredentials): Promise<CalendarSummary[]> {
    const response = await this.fetchFn(`${BASE_URL}/users/me/calendarList`, { headers: this.authHeaders(credentials) });
    if (!response.ok) {
      throw new Error(`Calendar listCalendars failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GoogleCalendarListResponse;
    return (body.items ?? []).map((item) => ({ id: item.id, summary: item.summary, primary: item.primary ?? false }));
  }

  async listEvents(
    credentials: IntegrationCredentials,
    options: { calendarId?: string; from?: string; to?: string } = {},
  ): Promise<CalendarEventSummary[]> {
    const calendarId = options.calendarId ?? DEFAULT_CALENDAR_ID;
    const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime' });
    if (options.from) params.set('timeMin', options.from);
    if (options.to) params.set('timeMax', options.to);

    const response = await this.fetchFn(`${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
      headers: this.authHeaders(credentials),
    });
    if (!response.ok) {
      throw new Error(`Calendar listEvents failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GoogleEventListResponse;
    return (body.items ?? []).map(toSummary);
  }

  async createEvent(credentials: IntegrationCredentials, input: CreateEventInput & { calendarId?: string }): Promise<CreateEventResult> {
    const calendarId = input.calendarId ?? DEFAULT_CALENDAR_ID;
    const response = await this.fetchFn(`${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: input.startsAt },
        end: { dateTime: input.endsAt },
      }),
    });
    if (!response.ok) {
      throw new Error(`Calendar createEvent failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GoogleEventResource;
    return { eventId: body.id };
  }

  async updateEvent(
    credentials: IntegrationCredentials,
    eventId: string,
    input: UpdateEventInput & { calendarId?: string },
  ): Promise<UpdateEventResult> {
    const calendarId = input.calendarId ?? DEFAULT_CALENDAR_ID;
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.summary = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.startsAt !== undefined) patch.start = { dateTime: input.startsAt };
    if (input.endsAt !== undefined) patch.end = { dateTime: input.endsAt };

    const response = await this.fetchFn(`${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      throw new Error(`Calendar updateEvent failed: ${await describeError(response)}`);
    }
    const body = (await response.json()) as GoogleEventResource;
    return { eventId: body.id };
  }

  async deleteEvent(credentials: IntegrationCredentials, eventId: string, options: { calendarId?: string } = {}): Promise<void> {
    const calendarId = options.calendarId ?? DEFAULT_CALENDAR_ID;
    const response = await this.fetchFn(`${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: this.authHeaders(credentials),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Calendar deleteEvent failed: ${await describeError(response)}`);
    }
  }

  private authHeaders(credentials: IntegrationCredentials): Record<string, string> {
    return { Authorization: `Bearer ${credentials.accessToken}` };
  }
}

function toSummary(event: GoogleEventResource): CalendarEventSummary {
  return {
    id: event.id,
    title: event.summary ?? '',
    startsAt: event.start?.dateTime ?? event.start?.date ?? '',
    endsAt: event.end?.dateTime ?? event.end?.date ?? '',
  };
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text();
  return `HTTP ${response.status}${text ? `: ${text}` : ''}`;
}
