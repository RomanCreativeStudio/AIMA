import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { MemoryService } from './memoryService';

test('createMemory rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new MemoryService(client, new MockEmbeddingProvider());
    await assert.rejects(
      () =>
        service.createMemory({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          scope: 'workspace',
          content: 'x',
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('creates a memory and finds it via ranked search', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'The client prefers email over phone calls.',
    });
    await service.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Favorite color is blue.',
    });

    const results = await service.search({
      workspaceId,
      query: 'Does the client prefer email or phone calls?',
      limit: 5,
    });

    assert.ok(results.length >= 1);
    assert.equal(results[0].content, 'The client prefers email over phone calls.');
    assert.ok(results[0].score > results[results.length - 1].score || results.length === 1);
  });
});

test('search respects workspace isolation', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({
      workspaceId: rcs.workspaceId,
      scope: 'workspace',
      content: 'Client Acme wants a full website redesign.',
    });
    await service.createMemory({
      workspaceId: mfs.workspaceId,
      scope: 'workspace',
      content: 'Character Kestrel backstory notes for the Fracture Protocol.',
    });

    const results = await service.search({ workspaceId: rcs.workspaceId, query: 'Acme redesign', limit: 10 });

    assert.ok(results.length >= 1);
    assert.ok(results.every((result) => result.workspaceId === rcs.workspaceId));
  });
});

test('conversation-scoped memory requires a conversationId', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await assert.rejects(
      () => service.createMemory({ workspaceId, scope: 'conversation', content: 'missing conversation id' }),
      /conversation.*requires conversationId/i,
    );
  });
});

test('project-scoped memory requires a projectKey', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await assert.rejects(
      () => service.createMemory({ workspaceId, scope: 'project', content: 'missing project key' }),
      /project.*requires projectKey/i,
    );
  });
});

test('conversation-scoped memory is retrievable by conversationId filter', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'mfs');
    const conversationId = await seedConversation(client, workspaceId);
    const otherConversationId = await seedConversation(client, workspaceId);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({
      workspaceId,
      scope: 'conversation',
      conversationId,
      content: 'In this thread we discussed act two pacing.',
    });
    await service.createMemory({
      workspaceId,
      scope: 'conversation',
      conversationId: otherConversationId,
      content: 'In this thread we discussed act two pacing.',
    });

    const results = await service.search({
      workspaceId,
      query: 'act two pacing',
      conversationId,
      limit: 10,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].conversationId, conversationId);
  });
});

test('project-scoped memory is retrievable by projectKey filter', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'mfs');
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({
      workspaceId,
      scope: 'project',
      projectKey: 'fracture-protocol-season-1',
      content: 'Season 1 finale reveals the fracture origin.',
    });
    await service.createMemory({
      workspaceId,
      scope: 'project',
      projectKey: 'other-project',
      content: 'Season 1 finale reveals the fracture origin.',
    });

    const results = await service.search({
      workspaceId,
      query: 'fracture origin reveal',
      projectKey: 'fracture-protocol-season-1',
      limit: 10,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].projectKey, 'fracture-protocol-season-1');
  });
});

test('getWorkspaceContext returns relevant memories across scopes', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({
      workspaceId,
      scope: 'user',
      content: 'Prefers a concise daily planning summary each morning.',
    });

    const context = await service.getWorkspaceContext(workspaceId, 'daily planning summary preferences');

    assert.ok(context.length >= 1);
    assert.equal(context[0].scope, 'user');
  });
});
