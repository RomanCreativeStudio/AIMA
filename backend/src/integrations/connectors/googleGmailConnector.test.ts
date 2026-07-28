import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFetch } from '../../testUtils/fakeFetch';
import { GoogleGmailConnector } from './googleGmailConnector';

const CREDENTIALS = { accessToken: 'access-1' };

test('testConnection requires an accessToken and calls the Gmail profile endpoint', async () => {
  const noCredentials = new GoogleGmailConnector(createFakeFetch([]).fetchFn);
  assert.equal((await noCredentials.testConnection({})).ok, false);

  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { emailAddress: 'you@example.com' } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  const result = await connector.testConnection(CREDENTIALS);

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer access-1');
});

test('testConnection reports failure with the provider detail when the API rejects the token', async () => {
  const { fetchFn } = createFakeFetch([{ status: 401, body: { error: { message: 'invalid_token' } } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  const result = await connector.testConnection(CREDENTIALS);

  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /401/);
});

test('listMessages lists inbox message ids then fetches each message metadata', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: { messages: [{ id: 'm1' }, { id: 'm2' }] } },
    { status: 200, body: { id: 'm1', snippet: 'Hi there', internalDate: '1700000000000', payload: { headers: [{ name: 'From', value: 'a@b.com' }, { name: 'Subject', value: 'Hello' }] } } },
    { status: 200, body: { id: 'm2', snippet: 'Second', internalDate: '1700000001000', payload: { headers: [{ name: 'From', value: 'c@d.com' }, { name: 'Subject', value: 'World' }] } } },
  ]);
  const connector = new GoogleGmailConnector(fetchFn);

  const messages = await connector.listMessages(CREDENTIALS, { limit: 2 });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].from, 'a@b.com');
  assert.equal(messages[0].subject, 'Hello');
  assert.equal(messages[1].snippet, 'Second');
  assert.match(calls[0].url, /labelIds=INBOX/);
});

test('listUnreadMessages queries is:unread', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { messages: [] } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  await connector.listUnreadMessages(CREDENTIALS);

  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'is:unread');
});

test('searchMessages passes the raw query through to Gmail', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { messages: [] } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  await connector.searchMessages(CREDENTIALS, 'from:client@example.com is:unread');

  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'from:client@example.com is:unread');
});

test('listMessages surfaces an error when the message list request fails', async () => {
  const { fetchFn } = createFakeFetch([{ status: 500, body: { error: 'boom' } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  await assert.rejects(() => connector.listMessages(CREDENTIALS), /Gmail message list failed/);
});

test('sendEmail posts a base64url-encoded RFC 2822 message and returns the resulting messageId', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { id: 'sent-1' } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  const result = await connector.sendEmail(CREDENTIALS, { to: 'client@example.com', subject: 'Hi', body: 'Hello there' });

  assert.equal(result.messageId, 'sent-1');
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  const sentBody = JSON.parse(calls[0].init?.body as string) as { raw: string };
  const decoded = Buffer.from(sentBody.raw, 'base64url').toString('utf8');
  assert.match(decoded, /To: client@example\.com/);
  assert.match(decoded, /Subject: Hi/);
  assert.match(decoded, /Hello there/);
});

test('sendEmail throws with the response detail when Gmail rejects the send', async () => {
  const { fetchFn } = createFakeFetch([{ status: 403, body: { error: 'insufficient scope' } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  await assert.rejects(() => connector.sendEmail(CREDENTIALS, { to: 'a@b.com', subject: 's', body: 'b' }), /Gmail sendEmail failed/);
});

test('saveDraft posts to the drafts endpoint and returns the resulting draftId', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { id: 'draft-1' } }]);
  const connector = new GoogleGmailConnector(fetchFn);

  const result = await connector.saveDraft(CREDENTIALS, { to: 'client@example.com', subject: 'Draft', body: 'Body text' });

  assert.equal(result.draftId, 'draft-1');
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts');
  const sentBody = JSON.parse(calls[0].init?.body as string) as { message: { raw: string } };
  assert.ok(sentBody.message.raw);
});
