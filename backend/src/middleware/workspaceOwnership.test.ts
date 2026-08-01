import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { Pool } from 'pg';
import { MockAuthProvider, issueMockTokens } from '../auth/mockAuthProvider';
import { WorkspaceService } from '../workspaces/workspaceService';
import { requireAuth, type AuthenticatedRequest } from './auth';
import { requireWorkspaceOwnership } from './workspaceOwnership';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/aima_test';

async function withTestServer(fn: (baseUrl: string, pool: Pool) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const workspaceService = new WorkspaceService(pool);

  const app = express();
  app.get(
    '/workspaces/:workspaceId/protected',
    requireAuth(new MockAuthProvider()),
    requireWorkspaceOwnership(workspaceService),
    (req: AuthenticatedRequest, res) => {
      res.json({ ok: true, userId: req.identity?.userId });
    },
  );

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await fn(`http://127.0.0.1:${port}`, pool);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

async function seedUserWithWorkspace(pool: Pool): Promise<{ userId: string; workspaceId: string }> {
  const email = `workspace-ownership-test-${randomUUID()}@example.com`;
  const userResult = await pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
  const userId = userResult.rows[0].id;

  const workspaceResult = await pool.query<{ id: string }>(
    'INSERT INTO workspaces (user_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
    [userId, 'personal', 'Personal'],
  );

  return { userId, workspaceId: workspaceResult.rows[0].id };
}

async function cleanupUser(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('requireWorkspaceOwnership allows the owning user through', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedUserWithWorkspace(pool);
    try {
      const tokens = issueMockTokens(userId);
      const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/protected`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      assert.equal(response.status, 200);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('requireWorkspaceOwnership returns 404 for a workspace owned by another user', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const owner = await seedUserWithWorkspace(pool);
    const intruder = await seedUserWithWorkspace(pool);
    try {
      const tokens = issueMockTokens(intruder.userId);
      const response = await fetch(`${baseUrl}/workspaces/${owner.workspaceId}/protected`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupUser(pool, owner.userId);
      await cleanupUser(pool, intruder.userId);
    }
  });
});

test('requireWorkspaceOwnership returns 404 for a nonexistent workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedUserWithWorkspace(pool);
    try {
      const tokens = issueMockTokens(userId);
      const response = await fetch(`${baseUrl}/workspaces/00000000-0000-0000-0000-000000000000/protected`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('requireWorkspaceOwnership returns 400 for a malformed workspaceId (not a UUID)', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedUserWithWorkspace(pool);
    try {
      const tokens = issueMockTokens(userId);
      const response = await fetch(`${baseUrl}/workspaces/not-a-uuid/protected`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('requireWorkspaceOwnership returns 401 without authentication', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedUserWithWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/protected`);
      assert.equal(response.status, 401);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});
