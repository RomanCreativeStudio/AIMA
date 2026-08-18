import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from './types';
import { ExecutionRegistry } from './registry';

class FakeExecutor implements ActionExecutor {
  constructor(readonly actionType: string, readonly provider: 'gmail' | 'github' | 'calendar' = 'gmail') {}
  async execute(_context: ExecutorContext): Promise<ExecutionOutcome> {
    return { responseSummary: {} };
  }
}

test('register/get/list round-trip', () => {
  const registry = new ExecutionRegistry();
  const executor = new FakeExecutor('send_email');
  registry.register(executor);

  assert.equal(registry.get('send_email'), executor);
  assert.equal(registry.get('unknown'), undefined);
  assert.deepEqual(registry.list(), [executor]);
});

test('constructor seeds from the provided list', () => {
  const a = new FakeExecutor('send_email');
  const b = new FakeExecutor('create_github_issue', 'github');
  const registry = new ExecutionRegistry([a, b]);

  assert.equal(registry.list().length, 2);
});

test('register throws on a duplicate actionType', () => {
  const registry = new ExecutionRegistry([new FakeExecutor('send_email')]);
  assert.throws(() => registry.register(new FakeExecutor('send_email')), /already registered/);
});
