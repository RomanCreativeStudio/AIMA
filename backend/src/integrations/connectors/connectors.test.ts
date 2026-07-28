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

test('StubGmailConnector.sendEmail returns a deterministic messageId and validates the input shape', async () => {
  const connector = new StubGmailConnector();
  const credentials = { accessToken: 'a', refreshToken: 'b' };

  const result = await connector.sendEmail(credentials, { to: 'client@example.com', subject: 'Hi', body: 'Hello' });
  assert.match(result.messageId, /^mock-message-/);

  await assert.rejects(() => connector.sendEmail(credentials, { to: '', subject: 'Hi', body: 'Hello' }));
  await assert.rejects(() => connector.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' }));
});

test('StubGmailConnector.saveDraft returns a deterministic draftId and validates the input shape', async () => {
  const connector = new StubGmailConnector();
  const credentials = { accessToken: 'a', refreshToken: 'b' };

  const result = await connector.saveDraft(credentials, { to: 'client@example.com', subject: 'Hi', body: 'Hello' });
  assert.match(result.draftId, /^mock-draft-/);

  await assert.rejects(() => connector.saveDraft(credentials, { to: 'client@example.com', subject: '', body: 'Hello' }));
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

test('StubGitHubConnector.createIssue returns a deterministic issue number and validates the input shape', async () => {
  const connector = new StubGitHubConnector();
  const credentials = { accessToken: 'a' };

  const result = await connector.createIssue(credentials, { repository: 'org/repo', title: 'Bug', body: 'Details' });
  assert.match(result.issueId, /^mock-issue-/);
  assert.ok(result.number > 0);

  await assert.rejects(() => connector.createIssue(credentials, { repository: '', title: 'Bug', body: '' }));
  await assert.rejects(() => connector.createIssue({}, { repository: 'org/repo', title: 'Bug', body: '' }));
});

test('StubGitHubConnector.createPullRequest returns a deterministic PR number and validates the input shape', async () => {
  const connector = new StubGitHubConnector();
  const credentials = { accessToken: 'a' };

  const result = await connector.createPullRequest(credentials, {
    repository: 'org/repo',
    title: 'Fix bug',
    body: 'Details',
    head: 'feature-branch',
    base: 'main',
  });
  assert.match(result.pullRequestId, /^mock-pr-/);
  assert.ok(result.number > 0);

  await assert.rejects(() =>
    connector.createPullRequest(credentials, { repository: 'org/repo', title: 'Fix bug', body: '', head: '', base: 'main' }),
  );
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
