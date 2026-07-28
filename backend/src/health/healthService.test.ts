import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AIProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';
import { withTestTransaction } from '../testUtils/db';
import { HealthService } from './healthService';

const okProvider: AIProvider = {
  name: 'mock',
  complete: async () => ({ content: '', model: 'mock', provider: 'mock' }),
};

test('check() reports ok for every subsystem against a real, migrated database', async () => {
  await withTestTransaction(async (client) => {
    const service = new HealthService(client, okProvider);
    const health = await service.check();

    assert.equal(health.status, 'ok');
    assert.equal(health.checks.database.status, 'ok');
    assert.equal(health.checks.memory.status, 'ok');
    assert.equal(health.checks.knowledge.status, 'ok');
    assert.equal(health.checks.aiProvider.status, 'ok');
    assert.equal(health.checks.aiProvider.detail, 'mock');
  });
});

test('check() reports error and includes a detail message when the database is unreachable', async () => {
  const brokenDb: Queryable = {
    query: async () => {
      throw new Error('connection terminated');
    },
  } as unknown as Queryable;

  const service = new HealthService(brokenDb, okProvider);
  const health = await service.check();

  assert.equal(health.status, 'error');
  assert.equal(health.checks.database.status, 'error');
  assert.equal(health.checks.memory.status, 'error');
  assert.equal(health.checks.knowledge.status, 'error');
  assert.match(health.checks.database.detail ?? '', /connection terminated/);
});

test('check() reports error for the AI provider when none is configured', async () => {
  await withTestTransaction(async (client) => {
    const missingProvider = { name: '' } as AIProvider;
    const service = new HealthService(client, missingProvider);
    const health = await service.check();

    assert.equal(health.checks.aiProvider.status, 'error');
    assert.equal(health.status, 'error');
  });
});

test('a single failing subsystem does not mask the others', async () => {
  await withTestTransaction(async (client) => {
    // A DB that only fails for one specific table, to prove checks run independently.
    const selectiveDb: Queryable = {
      query: async (sql: string, params?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('document_chunks')) {
          throw new Error('relation "document_chunks" does not exist');
        }
        return client.query(sql, params as never);
      },
    } as unknown as Queryable;

    const service = new HealthService(selectiveDb, okProvider);
    const health = await service.check();

    assert.equal(health.checks.knowledge.status, 'error');
    assert.equal(health.checks.database.status, 'ok');
    assert.equal(health.checks.memory.status, 'ok');
    assert.equal(health.status, 'error');
  });
});

test('check() reports integrations ok by default (all providers registered)', async () => {
  await withTestTransaction(async (client) => {
    const service = new HealthService(client, okProvider);
    const health = await service.check();

    assert.equal(health.checks.integrations.status, 'ok');
    assert.equal(health.checks.integrations.detail, 'gmail, github, calendar');
  });
});

test('check() reports integrations error and names the missing providers', async () => {
  await withTestTransaction(async (client) => {
    const service = new HealthService(client, okProvider, { gmail: true, github: false, calendar: false });
    const health = await service.check();

    assert.equal(health.checks.integrations.status, 'error');
    assert.equal(health.checks.integrations.detail, 'Not configured: github, calendar');
    assert.equal(health.status, 'error');
  });
});
