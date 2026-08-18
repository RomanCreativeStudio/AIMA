import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFetch } from '../../testUtils/fakeFetch';
import { GoogleCalendarConnector } from './googleCalendarConnector';

const CREDENTIALS = { accessToken: 'access-1' };

test('testConnection requires accessToken and calls the primary calendar endpoint', async () => {
  const empty = new GoogleCalendarConnector(createFakeFetch([]).fetchFn);
  assert.equal((await empty.testConnection({})).ok, false);

  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { id: 'primary' } }]);
  const connector = new GoogleCalendarConnector(fetchFn);

  assert.equal((await connector.testConnection(CREDENTIALS)).ok, true);
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/primary');
});

test('listCalendars maps the calendar list', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: { items: [{ id: 'primary', summary: 'Roman', primary: true }, { id: 'work@group.calendar.google.com', summary: 'Work' }] } },
  ]);
  const connector = new GoogleCalendarConnector(fetchFn);

  const calendars = await connector.listCalendars(CREDENTIALS);

  assert.equal(calendars.length, 2);
  assert.equal(calendars[0].primary, true);
  assert.equal(calendars[1].primary, false);
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/users/me/calendarList');
});

test('listEvents defaults to the primary calendar and maps start/end times', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: { items: [{ id: 'e1', summary: 'Standup', start: { dateTime: '2026-08-01T09:00:00Z' }, end: { dateTime: '2026-08-01T09:15:00Z' } }] } },
  ]);
  const connector = new GoogleCalendarConnector(fetchFn);

  const events = await connector.listEvents(CREDENTIALS);

  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Standup');
  assert.equal(events[0].startsAt, '2026-08-01T09:00:00Z');
  assert.ok(calls[0].url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events'));
});

test('listEvents targets a specific calendarId and applies from/to as timeMin/timeMax', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { items: [] } }]);
  const connector = new GoogleCalendarConnector(fetchFn);

  await connector.listEvents(CREDENTIALS, { calendarId: 'work@group.calendar.google.com', from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' });

  const url = new URL(calls[0].url);
  assert.ok(url.pathname.includes('/calendars/work%40group.calendar.google.com/events'));
  assert.equal(url.searchParams.get('timeMin'), '2026-08-01T00:00:00Z');
  assert.equal(url.searchParams.get('timeMax'), '2026-08-02T00:00:00Z');
});

test('createEvent posts to the events endpoint with start/end dateTimes and returns the eventId', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { id: 'created-1' } }]);
  const connector = new GoogleCalendarConnector(fetchFn);

  const result = await connector.createEvent(CREDENTIALS, { title: 'Kickoff', startsAt: '2026-08-01T10:00:00Z', endsAt: '2026-08-01T10:30:00Z', description: 'Notes' });

  assert.deepEqual(result, { eventId: 'created-1' });
  assert.ok(calls[0].url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events'));
  const sentBody = JSON.parse(calls[0].init?.body as string);
  assert.equal(sentBody.summary, 'Kickoff');
  assert.deepEqual(sentBody.start, { dateTime: '2026-08-01T10:00:00Z' });
});

test('updateEvent sends only the provided fields as a PATCH', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { id: 'event-1' } }]);
  const connector = new GoogleCalendarConnector(fetchFn);

  const result = await connector.updateEvent(CREDENTIALS, 'event-1', { title: 'Renamed' });

  assert.deepEqual(result, { eventId: 'event-1' });
  assert.equal(calls[0].init?.method, 'PATCH');
  const sentBody = JSON.parse(calls[0].init?.body as string);
  assert.deepEqual(sentBody, { summary: 'Renamed' });
});

test('deleteEvent sends a DELETE and tolerates a 404 (already deleted)', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 404 }]);
  const connector = new GoogleCalendarConnector(fetchFn);

  await connector.deleteEvent(CREDENTIALS, 'already-gone');

  assert.equal(calls[0].init?.method, 'DELETE');
});

test('deleteEvent throws on a genuine failure', async () => {
  const { fetchFn } = createFakeFetch([{ status: 403, body: { error: 'forbidden' } }]);
  const connector = new GoogleCalendarConnector(fetchFn);

  await assert.rejects(() => connector.deleteEvent(CREDENTIALS, 'event-1'), /Calendar deleteEvent failed/);
});
