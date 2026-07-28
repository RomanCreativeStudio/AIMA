import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INTEGRATIONS, IntegrationRegistry } from './registry';

test('IntegrationRegistry seeds the three fixed providers by default', () => {
  const registry = new IntegrationRegistry();

  const providers = registry.list().map((definition) => definition.provider);
  assert.deepEqual(new Set(providers), new Set(['gmail', 'github', 'calendar']));
});

test('get returns the definition for a known provider', () => {
  const registry = new IntegrationRegistry();

  const gmail = registry.get('gmail');
  assert.ok(gmail);
  assert.equal(gmail?.readCapability, 'read_email');
  assert.equal(gmail?.writeCapability, 'draft_gmail_email');
});

test('github has no writeCapability — it is read-only per Phase 2.3 scope', () => {
  const registry = new IntegrationRegistry();
  const github = registry.get('github');
  assert.ok(github);
  assert.equal(github?.writeCapability, undefined);
});

test('register throws when a provider is already registered', () => {
  const registry = new IntegrationRegistry([]);
  const gmailDefinition = DEFAULT_INTEGRATIONS.find((definition) => definition.provider === 'gmail')!;

  registry.register(gmailDefinition);
  assert.throws(() => registry.register(gmailDefinition), /already registered/);
});

test('every default integration requires at least one credential field', () => {
  for (const definition of DEFAULT_INTEGRATIONS) {
    assert.ok(definition.requiredCredentialFields.length > 0, `${definition.provider} should require credentials`);
  }
});
