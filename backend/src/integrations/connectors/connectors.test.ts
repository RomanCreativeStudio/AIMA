import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubCalendarConnector } from './calendarConnector';
import { StubGitHubConnector } from './githubConnector';
import { StubGmailConnector } from './gmailConnector';

test('StubGmailConnector.testConnection requires accessToken and refreshToken', async () => {
  const connector = new StubGmailConnector();

  assert.equal((await connector.testConnection({})).ok, false);
  assert.equal((await connector.testConnection({ accessToken: 'a' })).ok, false);
  assert.equal((await connector.testConnection({ accessToken: 'a', refreshToken: 'b' })).ok, true);
});

test('StubGmailConnector.listMessages returns deterministic sample data and respects limit', async () => {
  const connector = new StubGmailConnector();
  const credentials = { accessToken: 'a', refreshToken: 'b' };

  const all = await connector.listMessages(credentials);
  assert.ok(all.length > 0);

  const limited = await connector.listMessages(credentials, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].id, all[0].id);
});

test('StubGmailConnector.listMessages rejects invalid credentials', async () => {
  const connector = new StubGmailConnector();
  await assert.rejects(() => connector.listMessages({}));
});

test('StubGitHubConnector.testConnection requires accessToken', async () => {
  const connector = new StubGitHubConnector();

  assert.equal((await connector.testConnection({})).ok, false);
  assert.equal((await connector.testConnection({ accessToken: 'a' })).ok, true);
});

test('StubGitHubConnector.listRepositories and listIssues return deterministic sample data', async () => {
  const connector = new StubGitHubConnector();
  const credentials = { accessToken: 'a' };

  const repositories = await connector.listRepositories(credentials);
  assert.ok(repositories.length > 0);

  const issues = await connector.listIssues(credentials, repositories[0].fullName);
  assert.ok(issues.length > 0);
});

test('StubGitHubConnector.listIssues returns an empty list for an unknown repository', async () => {
  const connector = new StubGitHubConnector();
  const issues = await connector.listIssues({ accessToken: 'a' }, 'nonexistent/repo');
  assert.deepEqual(issues, []);
});

test('StubCalendarConnector.testConnection requires accessToken and refreshToken', async () => {
  const connector = new StubCalendarConnector();

  assert.equal((await connector.testConnection({})).ok, false);
  assert.equal((await connector.testConnection({ accessToken: 'a', refreshToken: 'b' })).ok, true);
});

test('StubCalendarConnector.listEvents returns all sample events with no range, and filters by from/to', async () => {
  const connector = new StubCalendarConnector();
  const credentials = { accessToken: 'a', refreshToken: 'b' };

  const all = await connector.listEvents(credentials);
  assert.ok(all.length >= 2);

  const filtered = await connector.listEvents(credentials, { from: all[1].startsAt });
  assert.ok(filtered.every((event) => event.startsAt >= all[1].startsAt));
  assert.ok(filtered.length < all.length);
});
