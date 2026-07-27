import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { ContextManager } from './contextManager';

test('gatherContext merges memory and document results, scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const contextManager = new ContextManager(memoryService, documentService);

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
    const contextManager = new ContextManager(memoryService, documentService);

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
    const contextManager = new ContextManager(memoryService, documentService);

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

test('gatherContext passes through the pre-fetched history unchanged', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const contextManager = new ContextManager(memoryService, documentService);

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
