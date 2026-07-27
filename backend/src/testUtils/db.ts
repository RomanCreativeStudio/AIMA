import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { WorkspaceSlug } from '../types/workspace';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/aima_test';

/**
 * Runs `fn` inside a transaction that is always rolled back, so integration
 * tests can hit a real Postgres instance (schema already applied per
 * database/README.md) without leaving state behind or needing a full
 * teardown/reset between tests.
 */
export async function withTestTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to the test database at ${TEST_DATABASE_URL}. ` +
        'Create it and apply database/migrations/*.sql first (see database/README.md), ' +
        'or set TEST_DATABASE_URL to point at an already-migrated database.\n' +
        `Original error: ${(error as Error).message}`,
    );
  }

  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

export async function seedWorkspace(
  client: Client,
  slug: WorkspaceSlug = 'development',
): Promise<{ userId: string; workspaceId: string }> {
  const email = `test-${randomUUID()}@example.com`;
  const userResult = await client.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [
    email,
  ]);
  const userId = userResult.rows[0].id;

  const workspaceResult = await client.query<{ id: string }>(
    'INSERT INTO workspaces (user_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
    [userId, slug, slug],
  );

  return { userId, workspaceId: workspaceResult.rows[0].id };
}

export async function seedConversation(client: Client, workspaceId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    'INSERT INTO conversations (workspace_id, title) VALUES ($1, $2) RETURNING id',
    [workspaceId, 'Test conversation'],
  );
  return result.rows[0].id;
}
