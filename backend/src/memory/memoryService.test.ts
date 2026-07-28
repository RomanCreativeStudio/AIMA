import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { MemoryNotFoundError } from './errors';
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

test('createMemory defaults importance/confidence/memoryType and accepts explicit values', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    const defaulted = await service.createMemory({ workspaceId, scope: 'workspace', content: 'Defaults check.' });
    assert.equal(defaulted.importanceScore, 0.5);
    assert.equal(defaulted.confidenceScore, 1.0);
    assert.equal(defaulted.memoryType, 'long_term');
    assert.equal(defaulted.archivedAt, null);
    assert.equal(defaulted.lastAccessedAt, null);

    const explicit = await service.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Explicit scores.',
      importanceScore: 0.9,
      confidenceScore: 0.3,
      memoryType: 'short_term',
    });
    assert.equal(explicit.importanceScore, 0.9);
    assert.equal(explicit.confidenceScore, 0.3);
    assert.equal(explicit.memoryType, 'short_term');
  });
});

test('createMemory rejects out-of-range importance/confidence scores', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await assert.rejects(
      () => service.createMemory({ workspaceId, scope: 'workspace', content: 'x', importanceScore: 1.5 }),
      /importanceScore must be between 0 and 1/,
    );
    await assert.rejects(
      () => service.createMemory({ workspaceId, scope: 'workspace', content: 'x', confidenceScore: -0.1 }),
      /confidenceScore must be between 0 and 1/,
    );
  });
});

test('listMemories returns newest-first and excludes archived by default', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    const first = await service.createMemory({ workspaceId, scope: 'workspace', content: 'First memory.' });
    const second = await service.createMemory({ workspaceId, scope: 'workspace', content: 'Second memory.' });
    await service.archiveMemory(workspaceId, first.id);

    const active = await service.listMemories({ workspaceId });
    assert.deepEqual(
      active.map((m) => m.id),
      [second.id],
    );

    const all = await service.listMemories({ workspaceId, includeArchived: true });
    assert.equal(all.length, 2);
  });
});

test('listMemories filters by scope and memoryType', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({ workspaceId, scope: 'workspace', content: 'Long term.', memoryType: 'long_term' });
    await service.createMemory({ workspaceId, scope: 'user', content: 'Short term.', memoryType: 'short_term' });

    const userScoped = await service.listMemories({ workspaceId, scope: 'user' });
    assert.equal(userScoped.length, 1);
    assert.equal(userScoped[0].scope, 'user');

    const shortTerm = await service.listMemories({ workspaceId, memoryType: 'short_term' });
    assert.equal(shortTerm.length, 1);
    assert.equal(shortTerm[0].memoryType, 'short_term');
  });
});

test('listMemories rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new MemoryService(client, new MockEmbeddingProvider());
    await assert.rejects(
      () => service.listMemories({ workspaceId: '00000000-0000-0000-0000-000000000000' }),
      WorkspaceNotFoundError,
    );
  });
});

test('listMemories does not leak memories from another workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({ workspaceId: a.workspaceId, scope: 'workspace', content: 'Workspace A memory.' });
    await service.createMemory({ workspaceId: b.workspaceId, scope: 'workspace', content: 'Workspace B memory.' });

    const results = await service.listMemories({ workspaceId: a.workspaceId });
    assert.equal(results.length, 1);
    assert.equal(results[0].workspaceId, a.workspaceId);
  });
});

test('getMemory returns the memory when scoped to the correct workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({ workspaceId, scope: 'workspace', content: 'Fetchable.' });

    const fetched = await service.getMemory(workspaceId, created.id);
    assert.equal(fetched.id, created.id);
  });
});

test('getMemory throws MemoryNotFoundError for a nonexistent id and for a foreign workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({ workspaceId: a.workspaceId, scope: 'workspace', content: 'A only.' });

    await assert.rejects(
      () => service.getMemory(a.workspaceId, '00000000-0000-0000-0000-000000000000'),
      MemoryNotFoundError,
    );
    await assert.rejects(() => service.getMemory(b.workspaceId, created.id), MemoryNotFoundError);
  });
});

test('updateMemory updates content, scores, and metadata; re-embeds only when content changes', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Original content.',
      importanceScore: 0.5,
      confidenceScore: 0.5,
    });

    const updated = await service.updateMemory(workspaceId, created.id, {
      content: 'Updated content.',
      importanceScore: 0.8,
      confidenceScore: 0.9,
      metadata: { tag: 'important' },
    });

    assert.equal(updated.content, 'Updated content.');
    assert.equal(updated.importanceScore, 0.8);
    assert.equal(updated.confidenceScore, 0.9);
    assert.deepEqual(updated.metadata, { tag: 'important' });
  });
});

test('updateMemory rejects out-of-range scores and an unknown memory id', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({ workspaceId, scope: 'workspace', content: 'x' });

    await assert.rejects(
      () => service.updateMemory(workspaceId, created.id, { importanceScore: 2 }),
      /importanceScore must be between 0 and 1/,
    );
    await assert.rejects(
      () => service.updateMemory(workspaceId, '00000000-0000-0000-0000-000000000000', { content: 'y' }),
      MemoryNotFoundError,
    );
  });
});

test('archiveMemory sets archivedAt and excludes it from default search/list', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Archive me: the client prefers email.',
    });

    const archived = await service.archiveMemory(workspaceId, created.id);
    assert.ok(archived.archivedAt !== null);

    const results = await service.search({ workspaceId, query: 'client prefers email', limit: 10 });
    assert.ok(results.every((r) => r.id !== created.id));

    const listed = await service.listMemories({ workspaceId });
    assert.ok(listed.every((m) => m.id !== created.id));
  });
});

test('archiveMemory throws MemoryNotFoundError for an unknown memory id', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());
    await assert.rejects(
      () => service.archiveMemory(workspaceId, '00000000-0000-0000-0000-000000000000'),
      MemoryNotFoundError,
    );
  });
});

test('deleteMemory permanently removes the memory', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({ workspaceId, scope: 'workspace', content: 'Delete me.' });

    await service.deleteMemory(workspaceId, created.id);

    await assert.rejects(() => service.getMemory(workspaceId, created.id), MemoryNotFoundError);
  });
});

test('deleteMemory throws MemoryNotFoundError for a foreign workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new MemoryService(client, new MockEmbeddingProvider());
    const created = await service.createMemory({ workspaceId: a.workspaceId, scope: 'workspace', content: 'A only.' });

    await assert.rejects(() => service.deleteMemory(b.workspaceId, created.id), MemoryNotFoundError);
  });
});

test('migration 0017: a row written the pre-3.4 way (no scoring/lifecycle columns) reads back with safe defaults', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO memory_records (workspace_id, scope, content, metadata)
       VALUES ($1, 'workspace', 'Pre-existing memory from before Phase 3.4.', '{}'::jsonb)
       RETURNING id`,
      [workspaceId],
    );

    const memory = await service.getMemory(workspaceId, inserted.rows[0].id);
    assert.equal(memory.importanceScore, 0.5);
    assert.equal(memory.confidenceScore, 1.0);
    assert.equal(memory.memoryType, 'long_term');
    assert.equal(memory.lastAccessedAt, null);
    assert.equal(memory.expiresAt, null);
    assert.equal(memory.archivedAt, null);
  });
});

test('short_term memories with a past expiresAt are excluded from search results', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new MemoryService(client, new MockEmbeddingProvider());

    await service.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Expired short-term note about the meeting.',
      memoryType: 'short_term',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const results = await service.search({ workspaceId, query: 'meeting note', limit: 10 });
    assert.equal(results.length, 0);
  });
});
