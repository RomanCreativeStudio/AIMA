import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { MockAuthProvider, issueMockTokens } from '../auth/mockAuthProvider';
import { requireAuth, type AuthenticatedRequest } from './auth';

async function withTestServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.get('/protected', requireAuth(new MockAuthProvider()), (req: AuthenticatedRequest, res) => {
    res.json({ userId: req.identity?.userId });
  });

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('requireAuth allows a request with a valid access token and injects identity', async () => {
  await withTestServer(async (baseUrl) => {
    const tokens = issueMockTokens('user-123');
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { userId: string };
    assert.equal(body.userId, 'user-123');
  });
});

test('requireAuth rejects a missing Authorization header with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`);
    assert.equal(response.status, 401);
  });
});

test('requireAuth rejects an invalid token with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: 'Bearer garbage-token' },
    });
    assert.equal(response.status, 401);
  });
});

test('requireAuth rejects an expired token with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const tokens = issueMockTokens('user-123', -1000);
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(response.status, 401);
  });
});
