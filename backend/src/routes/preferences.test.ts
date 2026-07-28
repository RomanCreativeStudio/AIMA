import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createAIProvider, MockEmbeddingProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from '../app';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AimaCoreService } from '../core/aimaCoreService';
import { DraftService } from '../drafts/draftService';
import { StubCalendarConnector } from '../integrations/connectors/calendarConnector';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import type { IntegrationConnector } from '../integrations/connectors/types';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import type { IntegrationProvider } from '../integrations/types';
import { ContextManager } from '../core/contextManager';
import { ConversationService } from '../conversation/conversationService';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PreferenceService } from '../preferences/preferenceService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { TaskService } from '../tasks/taskService';
import { HealthService } from '../health/healthService';
import { UserService } from '../users/userService';
import { WorkspaceService } from '../workspaces/workspaceService';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/aima_test';
const TEST_CREDENTIAL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

interface SeededWorkspace {
  userId: string;
  workspaceId: string;
}

async function withTestServer(fn: (baseUrl: string, pool: Pool) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const registry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(pool);
  const memoryService = new MemoryService(pool, new MockEmbeddingProvider());
  const documentService = new DocumentService(pool, new MockEmbeddingProvider());
  const taskService = new TaskService(pool);
  const draftService = new DraftService(pool);
  const integrationRegistry = new IntegrationRegistry();
  const credentialEncryptor = new AesGcmCredentialEncryptor(TEST_CREDENTIAL_ENCRYPTION_KEY);
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: new StubGmailConnector(),
    github: new StubGitHubConnector(),
    calendar: new StubCalendarConnector(),
  };
  const integrationService = new IntegrationService(pool, integrationRegistry, connectors, credentialEncryptor);
  const healthService = new HealthService(pool, createAIProvider({ provider: 'mock' }));
  const aiProvider = createAIProvider({ provider: 'mock' });
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const preferenceService = new PreferenceService(pool);
  const workspaceService = new WorkspaceService(pool);
  const userService = new UserService(pool);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const approvalEngine = new ApprovalEngine(pool, permissionEngine);
  const aimaCoreService = new AimaCoreService(contextManager, aiProvider, intentEngine, approvalEngine, workspaceService);
  const conversationService = new ConversationService({
    db: pool,
    aimaCoreService,
    actionLogger,
    permissionEngine,
  });

  const app = createApp({
    pool,
    registry,
    permissionEngine,
    actionLogger,
    integrationService,
    integrationRegistry,
    memoryService,
    documentService,
    taskService,
    draftService,
    preferenceService,
    workspaceService,
    userService,
    approvalEngine,
    healthService,
    conversationService,
    aiProvider,
    corsOrigins: [],
  });

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl, pool);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

async function seedWorkspace(pool: Pool): Promise<SeededWorkspace> {
  const email = `preference-route-test-${randomUUID()}@example.com`;
  const userResult = await pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [
    email,
  ]);
  const userId = userResult.rows[0].id;

  const workspaceResult = await pool.query<{ id: string }>(
    'INSERT INTO workspaces (user_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
    [userId, 'rcs', 'rcs'],
  );

  return { userId, workspaceId: workspaceResult.rows[0].id };
}

async function cleanupWorkspace(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('PUT /api/workspaces/:id/preferences sets a preference and logs the action', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'writing_style', key: 'tone', value: 'formal' }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        preference: { category: string; key: string; value: string };
        permission: { kind: string };
      };
      assert.equal(body.preference.category, 'writing_style');
      assert.equal(body.preference.value, 'formal');
      assert.equal(body.permission.kind, 'prepare');

      const log = await pool.query('SELECT summary, outcome FROM action_log WHERE workspace_id = $1', [
        workspaceId,
      ]);
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0].outcome, 'success');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('PUT .../preferences upserts on (category, key) instead of duplicating', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'writing_style', key: 'tone', value: 'formal' }),
      });
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'writing_style', key: 'tone', value: 'casual' }),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/preferences`);
      const body = (await response.json()) as { preferences: Array<{ value: string }> };
      assert.equal(body.preferences.length, 1);
      assert.equal(body.preferences[0].value, 'casual');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('PUT .../preferences rejects an invalid category', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'not_a_real_category', key: 'tone', value: 'formal' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('PUT .../preferences rejects an unknown workspaceId with 404, not 500', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'writing_style', key: 'tone', value: 'formal' }),
    });
    assert.equal(response.status, 404);
  });
});

test('GET .../preferences lists preferences scoped to the workspace and can filter by category', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'writing_style', key: 'tone', value: 'formal' }),
      });
      await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'workflow_preferences', key: 'cadence', value: 'weekly' }),
      });
      await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'writing_style', key: 'tone', value: 'playful' }),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/preferences`);
      const body = (await response.json()) as { preferences: Array<{ workspaceId: string }> };
      assert.equal(body.preferences.length, 2);
      assert.ok(body.preferences.every((preference) => preference.workspaceId === a.workspaceId));

      const filtered = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/preferences?category=writing_style`);
      const filteredBody = (await filtered.json()) as { preferences: Array<{ key: string }> };
      assert.equal(filteredBody.preferences.length, 1);
      assert.equal(filteredBody.preferences[0].key, 'tone');
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('DELETE .../preferences/:id removes the preference; 404s across workspaces', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'project_rules', key: 'deploy_freeze', value: 'no deploys after 5pm' }),
      });
      const { preference } = (await createResponse.json()) as { preference: { id: string } };

      const crossResponse = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/preferences/${preference.id}`, {
        method: 'DELETE',
      });
      assert.equal(crossResponse.status, 404);

      const deleteResponse = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/preferences/${preference.id}`, {
        method: 'DELETE',
      });
      assert.equal(deleteResponse.status, 200);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});
