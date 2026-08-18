import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { toVectorLiteral } from '../db/vector';
import { EmbeddingService } from './embeddingService';

/** Schema-level checks for database/migrations/0019_embeddings.sql, distinct from EmbeddingService's behavioral tests. */

/** The `embedding` column is a fixed VECTOR(1536) regardless of the embedding_models row's declared `dimensions`. */
function testVector(): string {
  return toVectorLiteral(new Array(1536).fill(0.01));
}

test('migration 0019: embedding_models enforces a unique (provider_name, model_name) pair', async () => {
  await withTestTransaction(async (client) => {
    const providerName = `test-provider-${randomUUID()}`;
    await client.query('INSERT INTO embedding_models (provider_name, model_name, dimensions) VALUES ($1, $1, 16)', [
      providerName,
    ]);
    await assert.rejects(() =>
      client.query('INSERT INTO embedding_models (provider_name, model_name, dimensions) VALUES ($1, $1, 16)', [
        providerName,
      ]),
    );
  });
});

test('migration 0019: embeddings enforces a unique (workspace_id, source_type, source_id, chunk_index)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const model = await client.query<{ id: string }>(
      'INSERT INTO embedding_models (provider_name, model_name, dimensions) VALUES ($1, $1, 4) RETURNING id',
      [`test-provider-${randomUUID()}`],
    );
    const sourceId = randomUUID();
    const vector = testVector();

    await client.query(
      `INSERT INTO embeddings
         (workspace_id, source_type, source_id, chunk_index, content, content_hash, embedding_model_id, embedding)
       VALUES ($1, 'task', $2, 0, 'a', 'hash-a', $3, $4::vector)`,
      [workspaceId, sourceId, model.rows[0].id, vector],
    );

    await assert.rejects(() =>
      client.query(
        `INSERT INTO embeddings
           (workspace_id, source_type, source_id, chunk_index, content, content_hash, embedding_model_id, embedding)
         VALUES ($1, 'task', $2, 0, 'b', 'hash-b', $3, $4::vector)`,
        [workspaceId, sourceId, model.rows[0].id, vector],
      ),
    );
  });
});

test('migration 0019: embeddings cascades on workspace delete (workspace isolation via FK)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const service = new EmbeddingService(client, new MockEmbeddingProvider());
    const sourceId = randomUUID();

    await service.indexContent({ workspaceId, sourceType: 'task', sourceId, content: 'To be cascaded away.' });

    await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);

    const rows = await client.query('SELECT 1 FROM embeddings WHERE workspace_id = $1', [workspaceId]);
    assert.equal(rows.rows.length, 0);
  });
});

test('migration 0019: embedding_source_type accepts every documented value', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const model = await client.query<{ id: string }>(
      'INSERT INTO embedding_models (provider_name, model_name, dimensions) VALUES ($1, $1, 4) RETURNING id',
      [`test-provider-${randomUUID()}`],
    );
    const vector = testVector();

    for (const sourceType of ['memory', 'conversation', 'task', 'note', 'document']) {
      await client.query(
        `INSERT INTO embeddings
           (workspace_id, source_type, source_id, chunk_index, content, content_hash, embedding_model_id, embedding)
         VALUES ($1, $2, $3, 0, 'x', 'hash', $4, $5::vector)`,
        [workspaceId, sourceType, randomUUID(), model.rows[0].id, vector],
      );
    }

    const rows = await client.query('SELECT source_type FROM embeddings WHERE workspace_id = $1', [workspaceId]);
    assert.equal(rows.rows.length, 5);
  });
});

test('migration 0019: embeddings defaults chunk_index to 0 and embedding_version to 1', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const model = await client.query<{ id: string }>(
      'INSERT INTO embedding_models (provider_name, model_name, dimensions) VALUES ($1, $1, 4) RETURNING id',
      [`test-provider-${randomUUID()}`],
    );
    const vector = testVector();

    const inserted = await client.query<{ chunk_index: number; embedding_version: number }>(
      `INSERT INTO embeddings
         (workspace_id, source_type, source_id, content, content_hash, embedding_model_id, embedding)
       VALUES ($1, 'task', $2, 'x', 'hash', $3, $4::vector)
       RETURNING chunk_index, embedding_version`,
      [workspaceId, randomUUID(), model.rows[0].id, vector],
    );

    assert.equal(inserted.rows[0].chunk_index, 0);
    assert.equal(inserted.rows[0].embedding_version, 1);
  });
});
