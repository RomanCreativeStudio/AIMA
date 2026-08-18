import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { DocumentService } from './documentService';
import { DocumentFormatNotImplementedError, DocumentNotFoundError } from './errors';

const MARKDOWN_DOC = [
  '# Client Onboarding',
  '',
  'This describes how Roman Creative Studio onboards a new client.',
  '',
  '## Step 1: Kickoff Call',
  '',
  'Schedule a 30 minute call to gather requirements.',
  '',
  '## Step 2: Proposal',
  '',
  'Draft a proposal covering scope, timeline, and price.',
].join('\n');

test('importDocument stores metadata and chunks with embeddings', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({
      workspaceId,
      format: 'markdown',
      content: MARKDOWN_DOC,
      source: 'onboarding.md',
      tags: ['onboarding', 'rcs'],
      version: '1.0',
    });

    assert.equal(document.workspaceId, workspaceId);
    assert.equal(document.title, 'Client Onboarding');
    assert.equal(document.format, 'markdown');
    assert.equal(document.source, 'onboarding.md');
    assert.deepEqual(document.tags, ['onboarding', 'rcs']);
    assert.equal(document.version, '1.0');
    assert.ok(document.importedAt);

    const chunkRows = await client.query('SELECT chunk_index, section, embedding FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index', [
      document.id,
    ]);
    assert.ok(chunkRows.rows.length > 0);
    for (const row of chunkRows.rows) {
      assert.ok(row.embedding, 'every chunk should have an embedding');
    }
  });
});

test('importDocument uses an explicit title over one inferred from content', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({
      workspaceId,
      format: 'markdown',
      content: MARKDOWN_DOC,
      title: 'RCS Client Onboarding Guide',
    });

    assert.equal(document.title, 'RCS Client Onboarding Guide');
  });
});

test('importDocument rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new DocumentService(client, new MockEmbeddingProvider());
    await assert.rejects(
      () =>
        service.importDocument({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          format: 'plaintext',
          content: 'hello',
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('importDocument with format "pdf" fails clearly (parsing deferred)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    await assert.rejects(
      () => service.importDocument({ workspaceId, format: 'pdf', content: '%PDF-1.4' }),
      DocumentFormatNotImplementedError,
    );

    const documents = await service.listDocuments(workspaceId);
    assert.equal(documents.length, 0, 'a failed import should not leave a partial document row');
  });
});

test('search finds relevant chunks ranked by similarity, scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    await service.importDocument({ workspaceId: rcs.workspaceId, format: 'markdown', content: MARKDOWN_DOC });
    await service.importDocument({
      workspaceId: mfs.workspaceId,
      format: 'plaintext',
      content: 'Character backstory notes for Kestrel in the Fracture Protocol.',
    });

    const results = await service.search(rcs.workspaceId, 'How do we onboard a new client?', 5);

    assert.ok(results.length > 0);
    assert.ok(results.every((result) => result.workspaceId === rcs.workspaceId));
    assert.ok(results.some((result) => result.content.includes('Kickoff Call') || result.content.includes('Proposal')));
  });
});

test('search results include the document title and section metadata', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({
      workspaceId,
      format: 'markdown',
      content: MARKDOWN_DOC,
      title: 'Onboarding Guide',
    });

    const results = await service.search(workspaceId, 'proposal scope timeline price', 5);
    const match = results.find((r) => r.documentId === document.id);

    assert.ok(match);
    assert.equal(match?.documentTitle, 'Onboarding Guide');
  });
});

test('listDocuments returns chunk counts and is scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    await service.importDocument({ workspaceId: rcs.workspaceId, format: 'markdown', content: MARKDOWN_DOC });
    await service.importDocument({ workspaceId: mfs.workspaceId, format: 'plaintext', content: 'Unrelated notes.' });

    const rcsDocuments = await service.listDocuments(rcs.workspaceId);
    assert.equal(rcsDocuments.length, 1);
    assert.ok((rcsDocuments[0].chunkCount ?? 0) > 0);
  });
});

test('getDocument throws DocumentNotFoundError for an id in a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({ workspaceId: rcs.workspaceId, format: 'plaintext', content: 'x' });

    await assert.rejects(() => service.getDocument(mfs.workspaceId, document.id), DocumentNotFoundError);
  });
});

test('reindexDocument re-chunks and re-embeds with new content and updates version', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({
      workspaceId,
      format: 'plaintext',
      content: 'Original content about the client.',
      version: '1.0',
    });

    const before = await client.query('SELECT id FROM document_chunks WHERE document_id = $1', [document.id]);

    const updated = await service.reindexDocument(workspaceId, document.id, {
      content: 'Completely new content about a different topic entirely.',
      version: '2.0',
    });

    assert.equal(updated.version, '2.0');

    const after = await client.query('SELECT id, content FROM document_chunks WHERE document_id = $1', [document.id]);
    assert.ok(after.rows.length > 0);
    assert.notDeepEqual(
      before.rows.map((r) => r.id).sort(),
      after.rows.map((r) => r.id).sort(),
      'reindexing should replace the old chunks with new ones',
    );
    assert.match(after.rows[0].content, /different topic/);
  });
});

test('reindexDocument without new content re-chunks the existing stored content', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({
      workspaceId,
      format: 'plaintext',
      content: 'Some stable content that should survive a reindex untouched.',
    });

    const updated = await service.reindexDocument(workspaceId, document.id);
    assert.equal(updated.id, document.id);

    const chunks = await client.query('SELECT content FROM document_chunks WHERE document_id = $1', [document.id]);
    assert.match(chunks.rows[0].content, /survive a reindex untouched/);
  });
});

test('deleteDocument removes the document and cascades to its chunks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({ workspaceId, format: 'plaintext', content: 'To be deleted.' });
    await service.deleteDocument(workspaceId, document.id);

    await assert.rejects(() => service.getDocument(workspaceId, document.id), DocumentNotFoundError);

    const chunks = await client.query('SELECT 1 FROM document_chunks WHERE document_id = $1', [document.id]);
    assert.equal(chunks.rows.length, 0);
  });
});

test('deleteDocument throws DocumentNotFoundError when the id belongs to a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const service = new DocumentService(client, new MockEmbeddingProvider());

    const document = await service.importDocument({ workspaceId: rcs.workspaceId, format: 'plaintext', content: 'x' });

    await assert.rejects(() => service.deleteDocument(mfs.workspaceId, document.id), DocumentNotFoundError);

    // Confirm it's untouched.
    const stillThere = await service.getDocument(rcs.workspaceId, document.id);
    assert.equal(stillThere.id, document.id);
  });
});
