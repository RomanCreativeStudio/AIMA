import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubGitHubConnector } from '../../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../../integrations/connectors/gmailConnector';
import { GitHubCreateIssueExecutor } from './githubCreateIssueExecutor';
import { GitHubCreatePullRequestExecutor } from './githubCreatePullRequestExecutor';
import { GmailSaveDraftExecutor } from './gmailSaveDraftExecutor';
import { GmailSendEmailExecutor } from './gmailSendEmailExecutor';

const GMAIL_CREDENTIALS = { accessToken: 'a', refreshToken: 'b' };
const GITHUB_CREDENTIALS = { accessToken: 'a' };

test('GmailSendEmailExecutor executes and summarizes the result', async () => {
  const executor = new GmailSendEmailExecutor(new StubGmailConnector());
  const outcome = await executor.execute({
    workspaceId: 'w1',
    payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    credentials: GMAIL_CREDENTIALS,
  });

  assert.equal(executor.actionType, 'send_email');
  assert.equal(executor.provider, 'gmail');
  assert.ok(typeof outcome.responseSummary.messageId === 'string');
  assert.equal(outcome.responseSummary.to, 'client@example.com');
});

test('GmailSendEmailExecutor rejects a malformed payload before contacting the connector', async () => {
  const executor = new GmailSendEmailExecutor(new StubGmailConnector());
  await assert.rejects(
    executor.execute({ workspaceId: 'w1', payload: { to: 'client@example.com' }, credentials: GMAIL_CREDENTIALS }),
    /must all be strings/,
  );
});

test('GmailSaveDraftExecutor executes and summarizes the result', async () => {
  const executor = new GmailSaveDraftExecutor(new StubGmailConnector());
  const outcome = await executor.execute({
    workspaceId: 'w1',
    payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    credentials: GMAIL_CREDENTIALS,
  });

  assert.equal(executor.actionType, 'draft_gmail_email');
  assert.ok(typeof outcome.responseSummary.draftId === 'string');
});

test('GitHubCreateIssueExecutor executes and summarizes the result', async () => {
  const executor = new GitHubCreateIssueExecutor(new StubGitHubConnector());
  const outcome = await executor.execute({
    workspaceId: 'w1',
    payload: { repository: 'org/repo', title: 'Bug', body: 'Details' },
    credentials: GITHUB_CREDENTIALS,
  });

  assert.equal(executor.actionType, 'create_github_issue');
  assert.equal(executor.provider, 'github');
  assert.ok(typeof outcome.responseSummary.issueId === 'string');
});

test('GitHubCreateIssueExecutor tolerates a missing optional body', async () => {
  const executor = new GitHubCreateIssueExecutor(new StubGitHubConnector());
  const outcome = await executor.execute({
    workspaceId: 'w1',
    payload: { repository: 'org/repo', title: 'Bug' },
    credentials: GITHUB_CREDENTIALS,
  });
  assert.ok(typeof outcome.responseSummary.issueId === 'string');
});

test('GitHubCreateIssueExecutor rejects a malformed payload', async () => {
  const executor = new GitHubCreateIssueExecutor(new StubGitHubConnector());
  await assert.rejects(
    executor.execute({ workspaceId: 'w1', payload: { title: 'Bug' }, credentials: GITHUB_CREDENTIALS }),
    /required strings/,
  );
});

test('GitHubCreatePullRequestExecutor executes and summarizes the result', async () => {
  const executor = new GitHubCreatePullRequestExecutor(new StubGitHubConnector());
  const outcome = await executor.execute({
    workspaceId: 'w1',
    payload: { repository: 'org/repo', title: 'Fix bug', body: 'Details', head: 'feature', base: 'main' },
    credentials: GITHUB_CREDENTIALS,
  });

  assert.equal(executor.actionType, 'create_github_pull_request');
  assert.ok(typeof outcome.responseSummary.pullRequestId === 'string');
});

test('GitHubCreatePullRequestExecutor rejects a malformed payload', async () => {
  const executor = new GitHubCreatePullRequestExecutor(new StubGitHubConnector());
  await assert.rejects(
    executor.execute({
      workspaceId: 'w1',
      payload: { repository: 'org/repo', title: 'Fix bug' },
      credentials: GITHUB_CREDENTIALS,
    }),
    /required strings/,
  );
});

test('executors propagate a connector-level failure (invalid credentials) as a rejection', async () => {
  const executor = new GmailSendEmailExecutor(new StubGmailConnector());
  await assert.rejects(
    executor.execute({
      workspaceId: 'w1',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
      credentials: {},
    }),
  );
});
