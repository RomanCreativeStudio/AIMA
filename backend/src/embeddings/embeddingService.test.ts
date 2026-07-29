import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { EmbeddingService } from './embeddingService';

test('indexContent rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    await assert.rejects(
      () =>
        service.indexContent({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          sourceType: 'task',
          sourceId: randomUUID(),
          content: 'x',
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('indexContent chunks and stores an embedding row per chunk', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();

    const result = await service.indexContent({
      workspaceId,
      sourceType: 'task',
      sourceId,
      content: 'A short task description.',
    });

    assert.equal(result.chunksIndexed, 1);
    assert.equal(result.chunksSkipped, 0);
    assert.equal(result.chunksDeleted, 0);

    const rows = await client.query(
      'SELECT chunk_index, content, embedding_version FROM embeddings WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3',
      [workspaceId, 'task', sourceId],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].embedding_version, 1);
  });
});

test('re-indexing identical content skips re-embedding (content-hash change detection)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();
    const content = 'Stable content that will not change.';

    await service.indexContent({ workspaceId, sourceType: 'conversation', sourceId, content });
    const second = await service.indexContent({ workspaceId, sourceType: 'conversation', sourceId, content });

    assert.equal(second.chunksIndexed, 0);
    assert.equal(second.chunksSkipped, 1);

    const rows = await client.query(
      'SELECT embedding_version FROM embeddings WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3',
      [workspaceId, 'conversation', sourceId],
    );
    assert.equal(rows.rows[0].embedding_version, 1);
  });
});

test('re-indexing changed content re-embeds and bumps embedding_version', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();

    await service.indexContent({ workspaceId, sourceType: 'conversation', sourceId, content: 'Original content.' });
    const second = await service.indexContent({
      workspaceId,
      sourceType: 'conversation',
      sourceId,
      content: 'Completely different content now.',
    });

    assert.equal(second.chunksIndexed, 1);
    assert.equal(second.chunksSkipped, 0);

    const rows = await client.query(
      'SELECT content, embedding_version FROM embeddings WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3',
      [workspaceId, 'conversation', sourceId],
    );
    assert.equal(rows.rows[0].content, 'Completely different content now.');
    assert.equal(rows.rows[0].embedding_version, 2);
  });
});

test('re-indexing with shorter content deletes now-stale trailing chunks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();
    const longContent = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} `.repeat(100)).join('\n\n');

    const first = await service.indexContent({ workspaceId, sourceType: 'task', sourceId, content: longContent });
    assert.ok(first.chunksIndexed > 1);

    const second = await service.indexContent({ workspaceId, sourceType: 'task', sourceId, content: 'Much shorter now.' });
    assert.ok(second.chunksDeleted > 0);

    const rows = await client.query(
      'SELECT chunk_index FROM embeddings WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3',
      [workspaceId, 'task', sourceId],
    );
    assert.equal(rows.rows.length, 1);
  });
});

test('deleteSource removes every indexed chunk for that source', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();

    await service.indexContent({ workspaceId, sourceType: 'task', sourceId, content: 'Some content to remove.' });
    await service.deleteSource(workspaceId, 'task', sourceId);

    const rows = await client.query(
      'SELECT 1 FROM embeddings WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3',
      [workspaceId, 'task', sourceId],
    );
    assert.equal(rows.rows.length, 0);
  });
});

test('indexContent scopes rows to their own workspace (isolation)', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();

    await service.indexContent({ workspaceId: a.workspaceId, sourceType: 'task', sourceId, content: 'Workspace A content.' });
    await service.indexContent({ workspaceId: b.workspaceId, sourceType: 'task', sourceId, content: 'Workspace B content.' });

    const aRows = await client.query('SELECT content FROM embeddings WHERE workspace_id = $1 AND source_id = $2', [
      a.workspaceId,
      sourceId,
    ]);
    const bRows = await client.query('SELECT content FROM embeddings WHERE workspace_id = $1 AND source_id = $2', [
      b.workspaceId,
      sourceId,
    ]);

    assert.equal(aRows.rows[0].content, 'Workspace A content.');
    assert.equal(bRows.rows[0].content, 'Workspace B content.');
  });
});
