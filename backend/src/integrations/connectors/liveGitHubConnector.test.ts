import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFetch } from '../../testUtils/fakeFetch';
import { LiveGitHubConnector } from './liveGitHubConnector';

const CREDENTIALS = { accessToken: 'gho_abc' };

test('testConnection requires accessToken and calls GET /user', async () => {
  const empty = new LiveGitHubConnector(createFakeFetch([]).fetchFn);
  assert.equal((await empty.testConnection({})).ok, false);

  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { login: 'roman' } }]);
  const connector = new LiveGitHubConnector(fetchFn);

  const result = await connector.testConnection(CREDENTIALS);

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://api.github.com/user');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer gho_abc');
  assert.equal(headers.Accept, 'application/vnd.github+json');
});

test('listRepositories maps the GitHub repository shape', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: [{ id: 1, full_name: 'org/repo', description: 'A repo', private: true }] },
  ]);
  const connector = new LiveGitHubConnector(fetchFn);

  const repos = await connector.listRepositories(CREDENTIALS);

  assert.deepEqual(repos, [{ id: '1', fullName: 'org/repo', description: 'A repo', isPrivate: true }]);
  assert.equal(calls[0].url, 'https://api.github.com/user/repos?per_page=100');
});

test('listIssues filters out pull requests (GitHub returns PRs from the issues endpoint too)', async () => {
  const { fetchFn, calls } = createFakeFetch([
    {
      status: 200,
      body: [
        { id: 1, number: 10, title: 'Real issue', state: 'open' },
        { id: 2, number: 11, title: 'A PR', state: 'open', pull_request: { url: 'https://api.github.com/...' } },
      ],
    },
  ]);
  const connector = new LiveGitHubConnector(fetchFn);

  const issues = await connector.listIssues(CREDENTIALS, 'org/repo');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, 'Real issue');
  assert.equal(calls[0].url, 'https://api.github.com/repos/org/repo/issues?state=all');
});

test('listPullRequests maps head/base branch names', async () => {
  const { fetchFn, calls } = createFakeFetch([
    { status: 200, body: [{ id: 5, number: 20, title: 'Add feature', state: 'open', head: { ref: 'feature' }, base: { ref: 'main' } }] },
  ]);
  const connector = new LiveGitHubConnector(fetchFn);

  const pullRequests = await connector.listPullRequests(CREDENTIALS, 'org/repo');

  assert.deepEqual(pullRequests, [{ id: '5', number: 20, title: 'Add feature', state: 'open', head: 'feature', base: 'main' }]);
  assert.equal(calls[0].url, 'https://api.github.com/repos/org/repo/pulls?state=all');
});

test('createIssue posts to the issues endpoint and returns the created issue id/number', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 201, body: { id: 42, number: 7 } }]);
  const connector = new LiveGitHubConnector(fetchFn);

  const result = await connector.createIssue(CREDENTIALS, { repository: 'org/repo', title: 'Bug', body: 'Details' });

  assert.deepEqual(result, { issueId: '42', number: 7 });
  assert.equal(calls[0].url, 'https://api.github.com/repos/org/repo/issues');
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), { title: 'Bug', body: 'Details' });
});

test('createIssue throws with the response detail on failure', async () => {
  const { fetchFn } = createFakeFetch([{ status: 422, body: { message: 'Validation failed' } }]);
  const connector = new LiveGitHubConnector(fetchFn);

  await assert.rejects(() => connector.createIssue(CREDENTIALS, { repository: 'org/repo', title: '', body: '' }), /GitHub createIssue failed/);
});

test('createPullRequest posts to the pulls endpoint and returns the created PR id/number', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 201, body: { id: 99, number: 12 } }]);
  const connector = new LiveGitHubConnector(fetchFn);

  const result = await connector.createPullRequest(CREDENTIALS, { repository: 'org/repo', title: 'Feature', body: 'Details', head: 'feature', base: 'main' });

  assert.deepEqual(result, { pullRequestId: '99', number: 12 });
  assert.equal(calls[0].url, 'https://api.github.com/repos/org/repo/pulls');
});

test('an invalid "repository" without an owner/repo slash throws before any request', async () => {
  const { fetchFn, calls } = createFakeFetch([]);
  const connector = new LiveGitHubConnector(fetchFn);

  await assert.rejects(() => connector.listIssues(CREDENTIALS, 'not-a-valid-repo'), /owner\/repo/);
  assert.equal(calls.length, 0);
});
