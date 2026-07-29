import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { MemoryService } from '../memory/memoryService';
import { WorkspaceNotFoundError } from '../types/errors';
import { EmbeddingService } from './embeddingService';
import { RetrievalService } from './retrievalService';

function buildServices(client: Parameters<typeof seedWorkspace>[0]) {
  const embeddingProvider = new MockEmbeddingProvider();
  const embeddingService = new EmbeddingService(client, embeddingProvider);
  const memoryService = new MemoryService(client, embeddingProvider);
  const retrievalService = new RetrievalService(client, embeddingProvider, embeddingService, memoryService);
  return { embeddingService, memoryService, retrievalService };
}

async function seedTask(
  client: Parameters<typeof seedWorkspace>[0],
  workspaceId: string,
  title: string,
  description: string | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    'INSERT INTO tasks (workspace_id, title, description) VALUES ($1, $2, $3) RETURNING id',
    [workspaceId, title, description],
  );
  return result.rows[0].id;
}

async function seedMessage(
  client: Parameters<typeof seedWorkspace>[0],
  workspaceId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await client.query('INSERT INTO messages (conversation_id, workspace_id, role, content) VALUES ($1, $2, $3, $4)', [
    conversationId,
    workspaceId,
    role,
    content,
  ]);
}

test('search rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const { retrievalService } = buildServices(client);
    await assert.rejects(
      () => retrievalService.search({ workspaceId: '00000000-0000-0000-0000-000000000000', query: 'x' }),
      WorkspaceNotFoundError,
    );
  });
});

test('search ranks the most similar chunk first', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const { embeddingService, retrievalService } = buildServices(client);

    await embeddingService.indexContent({
      workspaceId,
      sourceType: 'task',
      sourceId: randomUUID(),
      content: 'Finish the quarterly budget report for the finance team.',
    });
    await embeddingService.indexContent({
      workspaceId,
      sourceType: 'task',
      sourceId: randomUUID(),
      content: 'Buy groceries for the weekend barbecue.',
    });

    const results = await retrievalService.search({ workspaceId, query: 'quarterly finance budget report', limit: 5 });

    assert.ok(results.length >= 1);
    assert.ok(results[0].content.includes('budget report'));
    assert.ok(results.every((r) => typeof r.score === 'number'));
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score);
    }
  });
});

test('search respects workspace isolation', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { embeddingService, retrievalService } = buildServices(client);

    await embeddingService.indexContent({
      workspaceId: a.workspaceId,
      sourceType: 'task',
      sourceId: randomUUID(),
      content: 'Acme redesign kickoff task.',
    });
    await embeddingService.indexContent({
      workspaceId: b.workspaceId,
      sourceType: 'task',
      sourceId: randomUUID(),
      content: 'Kestrel character backstory task.',
    });

    const results = await retrievalService.search({ workspaceId: a.workspaceId, query: 'Acme redesign', limit: 10 });

    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.workspaceId === a.workspaceId));
  });
});

test('search filters by sourceTypes', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const { embeddingService, retrievalService } = buildServices(client);

    await embeddingService.indexContent({
      workspaceId,
      sourceType: 'task',
      sourceId: randomUUID(),
      content: 'Renew the domain registration.',
    });
    await embeddingService.indexContent({
      workspaceId,
      sourceType: 'conversation',
      sourceId: randomUUID(),
      content: 'user: When does the domain registration expire?',
    });

    const results = await retrievalService.search({
      workspaceId,
      query: 'domain registration',
      sourceTypes: ['task'],
      limit: 10,
    });

    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.sourceType === 'task'));
  });
});

test('getContext merges memories, related conversations, and related tasks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const conversationId = await seedConversation(client, workspaceId);
    const { embeddingService, memoryService, retrievalService } = buildServices(client);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'The client prefers async written updates over calls.',
    });
    await seedMessage(client, workspaceId, conversationId, 'user', 'Can we schedule a call this week?');
    await embeddingService.indexContent({
      workspaceId,
      sourceType: 'conversation',
      sourceId: conversationId,
      content: 'user: Can we schedule a call this week?',
    });
    const taskId = await seedTask(client, workspaceId, 'Schedule client call', 'Coordinate with the client on timing.');
    await embeddingService.indexContent({
      workspaceId,
      sourceType: 'task',
      sourceId: taskId,
      content: 'Schedule client call\n\nCoordinate with the client on timing.',
    });

    const context = await retrievalService.getContext({ workspaceId, query: 'schedule a call with the client' });

    assert.ok(context.memories.length >= 1);
    assert.ok(context.relatedConversations.length >= 1);
    assert.ok(context.relatedTasks.length >= 1);
    assert.ok(context.relatedConversations.every((r) => r.sourceType === 'conversation'));
    assert.ok(context.relatedTasks.every((r) => r.sourceType === 'task'));
  });
});

test('reindexWorkspace indexes every conversation and task in the workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const conversationId = await seedConversation(client, workspaceId);
    const { retrievalService } = buildServices(client);

    await seedMessage(client, workspaceId, conversationId, 'user', 'What is the status of the redesign project?');
    await seedMessage(client, workspaceId, conversationId, 'assistant', 'The redesign project is on track.');
    await seedTask(client, workspaceId, 'Ship the redesign', 'Finalize and deploy the new site.');

    const result = await retrievalService.reindexWorkspace(workspaceId);

    assert.equal(result.conversations.length, 1);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.conversations[0].chunksIndexed, 1);
    assert.equal(result.tasks[0].chunksIndexed, 1);

    const rows = await client.query('SELECT source_type FROM embeddings WHERE workspace_id = $1', [workspaceId]);
    const sourceTypes = rows.rows.map((row) => row.source_type).sort();
    assert.deepEqual(sourceTypes, ['conversation', 'task']);
  });
});

test('reindexWorkspace is idempotent: a second run re-embeds nothing when content is unchanged', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const conversationId = await seedConversation(client, workspaceId);
    const { retrievalService } = buildServices(client);

    await seedMessage(client, workspaceId, conversationId, 'user', 'Hello there.');
    await seedTask(client, workspaceId, 'A task', null);

    await retrievalService.reindexWorkspace(workspaceId);
    const second = await retrievalService.reindexWorkspace(workspaceId);

    assert.equal(second.conversations[0].chunksIndexed, 0);
    assert.equal(second.conversations[0].chunksSkipped, 1);
    assert.equal(second.tasks[0].chunksIndexed, 0);
    assert.equal(second.tasks[0].chunksSkipped, 1);
  });
});

test('reindexWorkspace rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const { retrievalService } = buildServices(client);
    await assert.rejects(
      () => retrievalService.reindexWorkspace('00000000-0000-0000-0000-000000000000'),
      WorkspaceNotFoundError,
    );
  });
});
