import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from './logger';

async function getCapabilityId(client: Client, actionType: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id FROM capabilities WHERE action_type = $1', [
    actionType,
  ]);
  return result.rows[0].id;
}

test('list returns entries newest first, scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const logger = new ActionLogger(client);
    const capabilityId = await getCapabilityId(client, 'create_task');

    await logger.log({ workspaceId, capabilityId, tier: 'automatic_safe', summary: 'first', outcome: 'success' });
    await logger.log({ workspaceId, capabilityId, tier: 'automatic_safe', summary: 'second', outcome: 'failure' });
    await logger.log({ workspaceId: otherWorkspaceId, tier: 'automatic_safe', summary: 'other workspace', outcome: 'success' });

    const entries = await logger.list(workspaceId);

    assert.equal(entries.length, 2);
    assert.equal(entries[0].summary, 'second', 'newest first');
    assert.equal(entries[1].summary, 'first');
    assert.equal(entries[0].actionType, 'create_task');
    assert.equal(entries[0].outcome, 'failure');
    assert.ok(entries.every((entry) => entry.workspaceId === workspaceId));
  });
});

test('list reports a null actionType for an entry logged without a capabilityId', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const logger = new ActionLogger(client);

    await logger.log({ workspaceId, tier: 'automatic_safe', summary: 'no capability', outcome: 'success' });

    const entries = await logger.list(workspaceId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actionType, null);
  });
});

test('list respects the limit parameter', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const logger = new ActionLogger(client);

    for (let i = 0; i < 5; i += 1) {
      await logger.log({ workspaceId, tier: 'automatic_safe', summary: `entry ${i}`, outcome: 'success' });
    }

    const entries = await logger.list(workspaceId, 2);
    assert.equal(entries.length, 2);
  });
});

test('countByOutcome tallies success and failure counts scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const logger = new ActionLogger(client);

    await logger.log({ workspaceId, tier: 'automatic_safe', summary: 'a', outcome: 'success' });
    await logger.log({ workspaceId, tier: 'automatic_safe', summary: 'b', outcome: 'success' });
    await logger.log({ workspaceId, tier: 'automatic_safe', summary: 'c', outcome: 'failure' });
    await logger.log({ workspaceId: otherWorkspaceId, tier: 'automatic_safe', summary: 'd', outcome: 'success' });

    const counts = await logger.countByOutcome(workspaceId);

    assert.deepEqual(counts, { success: 2, failure: 1, total: 3 });
  });
});

test('countByOutcome returns all zeros for a workspace with no logged actions', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const logger = new ActionLogger(client);

    const counts = await logger.countByOutcome(workspaceId);

    assert.deepEqual(counts, { success: 0, failure: 0, total: 0 });
  });
});
