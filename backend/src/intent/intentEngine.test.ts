import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IntentClassifier, IntentDetectionResult } from '@aima/ai-engine';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { IntentEngine } from './intentEngine';

/** Always returns a canned result — lets tests control the detected intent directly. */
class FixedIntentClassifier implements IntentClassifier {
  readonly name = 'fixed';
  constructor(private readonly result: IntentDetectionResult) {}

  async classify(): Promise<IntentDetectionResult> {
    return this.result;
  }
}

test('analyze reports no_approval_needed for the "chat" intent (Tier 1 capability)', async () => {
  const engine = new IntentEngine(
    new FixedIntentClassifier({ intent: 'chat', confidence: 0.5 }),
    new PermissionEngine(new CapabilityRegistry()),
  );

  const result = await engine.analyze('How is it going?');
  assert.equal(result.intent, 'chat');
  assert.equal(result.confidence, 0.5);
  assert.equal(result.approval, 'no_approval_needed');
  assert.match(result.suggestedNextAction, /conversational response/);
});

test('analyze reports no_approval_needed for "remember" (Tier 2 capability)', async () => {
  const engine = new IntentEngine(
    new FixedIntentClassifier({ intent: 'remember', confidence: 0.9 }),
    new PermissionEngine(new CapabilityRegistry()),
  );

  const result = await engine.analyze('Remember that the client prefers email.');
  assert.equal(result.approval, 'no_approval_needed');
  assert.match(result.suggestedNextAction, /Store this as a memory/);
});

test('analyze reports no_approval_needed for "search_memory" (no capability mapped)', async () => {
  const engine = new IntentEngine(
    new FixedIntentClassifier({ intent: 'search_memory', confidence: 0.85 }),
    new PermissionEngine(new CapabilityRegistry()),
  );

  const result = await engine.analyze('Do you remember what we discussed?');
  assert.equal(result.approval, 'no_approval_needed');
});

test('analyze reports approval_required when the mapped capability is Tier 3', async () => {
  // A registry where create_task has been (hypothetically) elevated to Tier 3,
  // proving the mapping is driven by the live tier, not hardcoded.
  const registry = new CapabilityRegistry([
    { actionType: 'create_task', defaultTier: 'execute_with_approval', tierLocked: false, description: '' },
  ]);
  const engine = new IntentEngine(
    new FixedIntentClassifier({ intent: 'create_task', confidence: 0.9 }),
    new PermissionEngine(registry),
  );

  const result = await engine.analyze('Add a task to call the client.');
  assert.equal(result.approval, 'approval_required');
});

test('analyze never creates a pending approval or writes to a database (metadata only)', async () => {
  // No db/pool is passed to IntentEngine at all — this is enforced by its
  // constructor signature (classifier + PermissionEngine only), but assert
  // the result shape stays plain data with no side-effect handles.
  const engine = new IntentEngine(
    new FixedIntentClassifier({ intent: 'draft_email', confidence: 0.9 }),
    new PermissionEngine(new CapabilityRegistry()),
  );

  const result = await engine.analyze('Draft an email to the client.');
  assert.deepEqual(Object.keys(result).sort(), ['approval', 'confidence', 'intent', 'suggestedNextAction']);
});
