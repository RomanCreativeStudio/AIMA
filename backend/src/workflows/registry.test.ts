import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WORKFLOWS, WorkflowRegistry } from './registry';

test('WorkflowRegistry seeds the four built-in workflows by default', () => {
  const registry = new WorkflowRegistry();

  const keys = registry.list().map((definition) => definition.key);
  assert.deepEqual(
    new Set(keys),
    new Set(['draft_email_reply', 'create_github_issue_draft', 'summarize_unread_email', 'daily_workspace_briefing']),
  );
});

test('get returns the definition for a known workflow', () => {
  const registry = new WorkflowRegistry();

  const summarize = registry.get('summarize_unread_email');
  assert.ok(summarize);
  assert.equal(summarize?.steps.length, 2);
  assert.equal(summarize?.steps[0].capability, 'read_email');
  assert.equal(summarize?.steps[1].capability, undefined);
});

test('register throws when a workflow is already registered', () => {
  const registry = new WorkflowRegistry([]);
  const definition = DEFAULT_WORKFLOWS.find((workflow) => workflow.key === 'draft_email_reply')!;

  registry.register(definition);
  assert.throws(() => registry.register(definition), /already registered/);
});

test('every built-in workflow has at least one step and a non-empty trigger phrase list', () => {
  for (const definition of DEFAULT_WORKFLOWS) {
    assert.ok(definition.steps.length > 0, `${definition.key} should have steps`);
    assert.ok(definition.triggerPhrases.length > 0, `${definition.key} should have trigger phrases`);
  }
});
