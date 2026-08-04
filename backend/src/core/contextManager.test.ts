import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PreferenceService } from '../preferences/preferenceService';
import { TaskService } from '../tasks/taskService';
import type { RankedMemoryResult } from '../memory/types';
import { ContextManager, deduplicateDecisions } from './contextManager';

test('gatherContext merges memory and document results, scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Client Acme wants a full redesign.',
    });
    await documentService.importDocument({
      workspaceId,
      format: 'markdown',
      content: '# Onboarding\n\nSchedule a kickoff call for the redesign project.',
    });

    const context = await contextManager.gatherContext(workspaceId, 'rcs', 'Acme redesign kickoff', []);

    assert.equal(context.workspaceSlug, 'rcs');
    assert.ok(context.memories.length > 0);
    assert.ok(context.documentChunks.length > 0);
    assert.deepEqual(context.history, []);
  });
});

test('gatherContext never returns memory or document chunks from a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    await memoryService.createMemory({
      workspaceId: b.workspaceId,
      scope: 'workspace',
      content: 'Kestrel backstory notes that should never leak into RCS.',
    });
    await documentService.importDocument({
      workspaceId: b.workspaceId,
      format: 'plaintext',
      content: 'Kestrel character sheet.',
    });

    const context = await contextManager.gatherContext(a.workspaceId, 'rcs', 'Tell me about Kestrel', []);

    assert.equal(context.memories.length, 0);
    assert.equal(context.documentChunks.length, 0);
  });
});

test('gatherContext respects configurable memory and document limits', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    for (let i = 0; i < 5; i++) {
      await memoryService.createMemory({ workspaceId, scope: 'workspace', content: `fact ${i} about planning` });
      await documentService.importDocument({
        workspaceId,
        format: 'plaintext',
        content: `document ${i} about planning`,
      });
    }

    const context = await contextManager.gatherContext(workspaceId, 'personal', 'planning', [], {
      memoryLimit: 2,
      documentLimit: 3,
    });

    assert.ok(context.memories.length <= 2);
    assert.ok(context.documentChunks.length <= 3);
  });
});

test('gatherContext includes workspace preferences, isolated from other workspaces', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    await preferenceService.setPreference({
      workspaceId: a.workspaceId,
      category: 'writing_style',
      key: 'tone',
      value: 'formal',
    });
    await preferenceService.setPreference({
      workspaceId: b.workspaceId,
      category: 'writing_style',
      key: 'tone',
      value: 'playful',
    });

    const context = await contextManager.gatherContext(a.workspaceId, 'rcs', 'anything', []);

    assert.equal(context.preferences.length, 1);
    assert.equal(context.preferences[0].value, 'formal');
  });
});

test('gatherContext ranks open tasks with overdue first and respects the configurable taskLimit', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const taskService = new TaskService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService, taskService);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const overdue = await taskService.createTask({ workspaceId, title: 'Overdue task', dueDate: yesterday, priority: 'low' });
    await taskService.createTask({ workspaceId, title: 'No due date', priority: 'low' });
    await taskService.createTask({ workspaceId, title: 'Another no due date', priority: 'low' });
    const done = await taskService.createTask({ workspaceId, title: 'Already done', priority: 'high' });
    await taskService.updateTask(workspaceId, done.id, { status: 'done' });

    const context = await contextManager.gatherContext(workspaceId, 'rcs', 'anything', [], { taskLimit: 2 });

    assert.equal(context.tasks.length, 2, 'taskLimit caps the ranked list');
    assert.equal(context.tasks[0].id, overdue.id, 'overdue task ranks first, same as rankTasksByPriority everywhere else');
    assert.ok(context.tasks.every((task) => task.status !== 'done'), 'done tasks are never open-task context');
  });
});

test('gatherContext defaults tasks to empty when no taskService was configured', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    const context = await contextManager.gatherContext(workspaceId, 'rcs', 'anything', []);

    assert.deepEqual(context.tasks, []);
  });
});

test('gatherContext tasks are workspace-isolated', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const taskService = new TaskService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService, taskService);

    await taskService.createTask({ workspaceId: b.workspaceId, title: 'Other workspace task' });

    const context = await contextManager.gatherContext(a.workspaceId, 'rcs', 'anything', []);

    assert.deepEqual(context.tasks, []);
  });
});

test('gatherContext surfaces recent decisions, deduplicated against relevance-ranked memories, respecting decisionLimit', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "We've decided to ship on Friday.",
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "We've decided to use Postgres.",
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'A hand-saved fact, not a decision.',
    });

    // memoryLimit: 0 keeps this test focused on decisionLimit/surfacing, independent of MockEmbeddingProvider's
    // relevance ranking — the dedup logic itself (excluding a decision already present in `memories`) is
    // covered directly by the `deduplicateDecisions` unit tests below.
    const context = await contextManager.gatherContext(workspaceId, 'rcs', 'anything', [], {
      memoryLimit: 0,
      decisionLimit: 1,
    });

    assert.equal(context.decisions.length, 1, 'decisionLimit caps the list');
    assert.ok(context.decisions.every((d) => d.metadata.category === 'decision'));
  });
});

test('gatherContext decisions are workspace-isolated', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    await memoryService.createMemory({
      workspaceId: b.workspaceId,
      scope: 'workspace',
      content: 'A decision in the other workspace.',
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });

    const context = await contextManager.gatherContext(a.workspaceId, 'rcs', 'anything', []);

    assert.deepEqual(context.decisions, []);
  });
});

test('deduplicateDecisions excludes a decision memory already present in the relevance-ranked memories list', () => {
  const memories: RankedMemoryResult[] = [
    {
      id: 'mem-1',
      workspaceId: 'ws-1',
      scope: 'workspace',
      content: 'shared',
      source: 'auto_extracted',
      conversationId: null,
      projectKey: null,
      metadata: { category: 'decision' },
      createdAt: new Date().toISOString(),
      importanceScore: 0.5,
      confidenceScore: 1,
      memoryType: 'long_term',
      lastAccessedAt: null,
      expiresAt: null,
      archivedAt: null,
      score: 0.9,
    },
  ];
  const decisions = [
    { ...memories[0] },
    { ...memories[0], id: 'mem-2', content: 'a genuinely different decision' },
  ];

  const deduped = deduplicateDecisions(decisions, memories);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'mem-2');
});

test('gatherContext passes through the pre-fetched history unchanged', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);

    const history = [
      {
        id: 'msg-1',
        conversationId: 'conv-1',
        workspaceId,
        role: 'user' as const,
        content: 'hello',
        createdAt: new Date().toISOString(),
      },
    ];

    const context = await contextManager.gatherContext(workspaceId, 'development', 'hello', history);
    assert.deepEqual(context.history, history);
  });
});
