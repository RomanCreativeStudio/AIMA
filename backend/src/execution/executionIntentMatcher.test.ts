import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import { ExecutionIntentMatcher } from './executionIntentMatcher';
import { GitHubCreateIssueExecutor } from './executors/githubCreateIssueExecutor';
import { GitHubCreatePullRequestExecutor } from './executors/githubCreatePullRequestExecutor';
import { GmailSaveDraftExecutor } from './executors/gmailSaveDraftExecutor';
import { GmailSendEmailExecutor } from './executors/gmailSendEmailExecutor';
import { ExecutionRegistry } from './registry';

function buildMatcher(): ExecutionIntentMatcher {
  const gmailConnector = new StubGmailConnector();
  const githubConnector = new StubGitHubConnector();
  const registry = new ExecutionRegistry([
    new GmailSendEmailExecutor(gmailConnector),
    new GmailSaveDraftExecutor(gmailConnector),
    new GitHubCreateIssueExecutor(githubConnector),
    new GitHubCreatePullRequestExecutor(githubConnector),
  ]);
  return new ExecutionIntentMatcher(registry);
}

test('matches "send an email to" as send_email and extracts the recipient', () => {
  const matcher = buildMatcher();
  const suggestion = matcher.match('Send an email to client@example.com about the invoice');

  assert.ok(suggestion);
  assert.equal(suggestion!.actionType, 'send_email');
  assert.equal(suggestion!.provider, 'gmail');
  assert.equal(suggestion!.extractedPayload.to, 'client@example.com');
  assert.equal(suggestion!.extractedPayload.subject, 'the invoice');
});

test('matches a gmail draft phrase as draft_gmail_email', () => {
  const matcher = buildMatcher();
  const suggestion = matcher.match('Save this as a gmail draft');

  assert.ok(suggestion);
  assert.equal(suggestion!.actionType, 'draft_gmail_email');
});

test('matches "open an issue on github" as create_github_issue and extracts the repository', () => {
  const matcher = buildMatcher();
  const suggestion = matcher.match('Open an issue on github repo org/repo about a login bug');

  assert.ok(suggestion);
  assert.equal(suggestion!.actionType, 'create_github_issue');
  assert.equal(suggestion!.provider, 'github');
  assert.equal(suggestion!.extractedPayload.repository, 'org/repo');
  assert.equal(suggestion!.extractedPayload.title, 'a login bug');
});

test('matches "open a pull request" as create_github_pull_request', () => {
  const matcher = buildMatcher();
  const suggestion = matcher.match('Open a pull request for repo org/repo');

  assert.ok(suggestion);
  assert.equal(suggestion!.actionType, 'create_github_pull_request');
});

test('returns null for ordinary conversation', () => {
  const matcher = buildMatcher();
  assert.equal(matcher.match("What's the weather like?"), null);
});

test('returns null for empty or whitespace-only input', () => {
  const matcher = buildMatcher();
  assert.equal(matcher.match(''), null);
  assert.equal(matcher.match('   '), null);
});

test('returns null when a matching phrase has no registered executor', () => {
  const matcher = new ExecutionIntentMatcher(new ExecutionRegistry());
  assert.equal(matcher.match('Send an email to client@example.com'), null);
});
