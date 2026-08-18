import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowRegistry } from './registry';
import { WorkflowIntentMatcher } from './workflowIntentMatcher';

test('matches "summarize my unread email" and extracts an explicit limit', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  const suggestion = matcher.match('Can you summarize my last 3 unread emails?');

  assert.ok(suggestion);
  assert.equal(suggestion?.workflowKey, 'summarize_unread_email');
  assert.equal(suggestion?.extractedInput.limit, '3');
});

test('matches a daily briefing request with no input needed', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  const suggestion = matcher.match('Give me my daily briefing');

  assert.ok(suggestion);
  assert.equal(suggestion?.workflowKey, 'daily_workspace_briefing');
  assert.deepEqual(suggestion?.extractedInput, {});
});

test('matches "reply to X about Y" and extracts both recipientName and topic', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  const suggestion = matcher.match('Please reply to Sarah about the project deadline');

  assert.ok(suggestion);
  assert.equal(suggestion?.workflowKey, 'draft_email_reply');
  assert.equal(suggestion?.extractedInput.recipientName, 'Sarah');
  assert.equal(suggestion?.extractedInput.topic, 'the project deadline');
});

test('matches a github issue request and extracts repository and summary', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  const suggestion = matcher.match('Create a github issue for AIMA/backend about a flaky migration test');

  assert.ok(suggestion);
  assert.equal(suggestion?.workflowKey, 'create_github_issue_draft');
  assert.equal(suggestion?.extractedInput.repository, 'AIMA/backend');
  assert.equal(suggestion?.extractedInput.summary, 'a flaky migration test');
});

test('returns null for ordinary chat with no workflow trigger phrase', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  assert.equal(matcher.match('What time is it?'), null);
});

test('returns null for empty or whitespace-only input', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  assert.equal(matcher.match(''), null);
  assert.equal(matcher.match('   '), null);
});

test('every match carries the definition steps and a real confidence', () => {
  const matcher = new WorkflowIntentMatcher(new WorkflowRegistry());

  const suggestion = matcher.match('draft an email reply about the invoice');

  assert.ok(suggestion);
  assert.ok(suggestion!.steps.length > 0);
  assert.ok(suggestion!.confidence > 0 && suggestion!.confidence <= 1);
});
