import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from './registry';
import { PermissionEngine } from './engine';

test('evaluate maps each tier to the correct decision kind', () => {
  const registry = new CapabilityRegistry([
    { actionType: 'a', defaultTier: 'suggest', tierLocked: false, description: '' },
    { actionType: 'b', defaultTier: 'prepare', tierLocked: false, description: '' },
    { actionType: 'c', defaultTier: 'execute_with_approval', tierLocked: true, description: '' },
    { actionType: 'd', defaultTier: 'automatic_safe', tierLocked: false, description: '' },
  ]);
  const engine = new PermissionEngine(registry);

  assert.deepEqual(engine.evaluate('a'), { kind: 'suggest' });
  assert.deepEqual(engine.evaluate('b'), { kind: 'prepare' });
  assert.deepEqual(engine.evaluate('c'), { kind: 'requires_approval' });
  assert.deepEqual(engine.evaluate('d'), { kind: 'auto_execute' });
});

test('resolveTier throws for an unregistered capability', () => {
  const engine = new PermissionEngine(new CapabilityRegistry([]));
  assert.throws(() => engine.resolveTier('unknown'), /Unregistered capability/);
});

test('the default capability registry has no capability defaulting to automatic_safe (docs/PRODUCT_BIBLE.md §9 Rule 6)', () => {
  const registry = new CapabilityRegistry();
  const promoted = registry.list().filter((capability) => capability.defaultTier === 'automatic_safe');
  assert.equal(promoted.length, 0);
});

test('send_email is permanently tier-locked at execute_with_approval (docs/PRODUCT_BIBLE.md §5)', () => {
  const registry = new CapabilityRegistry();
  const sendEmail = registry.get('send_email');
  assert.ok(sendEmail);
  assert.equal(sendEmail?.tierLocked, true);
  assert.equal(sendEmail?.defaultTier, 'execute_with_approval');
});
