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
import type { ApprovalDecision } from '../approval/types';
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
import { syncCapabilitiesToDatabase } from '../permissions/syncCapabilities';
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
  await syncCapabilitiesToDatabase(pool, registry); // required before ApprovalEngine can create a pending approval
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
  const email = `approval-route-test-${randomUUID()}@example.com`;
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

/** Creates a real pending approval directly through ApprovalEngine — there's no public "create" route by design (see routes/approvals.ts). */
async function createApproval(pool: Pool, workspaceId: string, payload: unknown = {}): Promise<ApprovalDecision> {
  const engine = new ApprovalEngine(pool, new PermissionEngine(new CapabilityRegistry()));
  return engine.evaluate(workspaceId, 'send_email', payload);
}

test('GET .../approvals lists approvals scoped to the workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      await createApproval(pool, a.workspaceId, { to: 'first@example.com' });
      await createApproval(pool, a.workspaceId, { to: 'second@example.com' });
      await createApproval(pool, b.workspaceId, { to: 'other@example.com' });

      const response = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/approvals`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { approvals: Array<{ workspaceId: string; status: string }> };
      assert.equal(body.approvals.length, 2);
      assert.ok(body.approvals.every((approval) => approval.workspaceId === a.workspaceId));
      assert.ok(body.approvals.every((approval) => approval.status === 'pending'));
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('GET .../approvals filters by status', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const pending = await createApproval(pool, workspaceId);
      const toApprove = await createApproval(pool, workspaceId);
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/${toApprove.pendingApprovalId}/approve`, {
        method: 'POST',
      });

      const pendingOnly = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals?status=pending`);
      const pendingBody = (await pendingOnly.json()) as { approvals: Array<{ id: string }> };
      assert.deepEqual(
        pendingBody.approvals.map((approval) => approval.id),
        [pending.pendingApprovalId],
      );

      const approvedOnly = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals?status=approved`);
      const approvedBody = (await approvedOnly.json()) as { approvals: Array<{ id: string }> };
      assert.deepEqual(
        approvedBody.approvals.map((approval) => approval.id),
        [toApprove.pendingApprovalId],
      );
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../approvals/:id returns the full approval record', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, workspaceId, { to: 'client@example.com' });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.pendingApprovalId}`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        approval: { actionType: string; status: string; payload: unknown };
      };
      assert.equal(body.approval.actionType, 'send_email');
      assert.equal(body.approval.status, 'pending');
      assert.deepEqual(body.approval.payload, { to: 'client@example.com' });
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../approvals/:id returns 404 across workspaces (isolation)', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, a.workspaceId);

      const response = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/approvals/${created.pendingApprovalId}`);
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('GET .../approvals/:id rejects a malformed id', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/not-a-uuid`);
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../approvals/:id/approve transitions a pending approval to approved', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, workspaceId);

      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.pendingApprovalId}/approve`,
        { method: 'POST' },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { decision: ApprovalDecision };
      assert.equal(body.decision.state, 'approved');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../approvals/:id/reject transitions a pending approval to rejected', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, workspaceId);

      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.pendingApprovalId}/reject`,
        { method: 'POST' },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { decision: ApprovalDecision };
      assert.equal(body.decision.state, 'rejected');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../approvals/:id/approve returns 404 across workspaces and does not resolve it', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, a.workspaceId);

      const response = await fetch(
        `${baseUrl}/api/workspaces/${b.workspaceId}/approvals/${created.pendingApprovalId}/approve`,
        { method: 'POST' },
      );
      assert.equal(response.status, 404);

      const stillPending = await fetch(
        `${baseUrl}/api/workspaces/${a.workspaceId}/approvals/${created.pendingApprovalId}`,
      );
      const body = (await stillPending.json()) as { approval: { status: string } };
      assert.equal(body.approval.status, 'pending');
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('POST .../approvals/:id/approve returns 409 for an already-resolved approval', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, workspaceId);
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.pendingApprovalId}/approve`, {
        method: 'POST',
      });

      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.pendingApprovalId}/approve`,
        { method: 'POST' },
      );
      assert.equal(response.status, 409);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../approvals/:id/approve returns 410 for an expired approval', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const created = await createApproval(pool, workspaceId);
      await pool.query("UPDATE pending_approvals SET expires_at = now() - interval '1 hour' WHERE id = $1", [
        created.pendingApprovalId,
      ]);

      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.pendingApprovalId}/approve`,
        { method: 'POST' },
      );
      assert.equal(response.status, 410);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});
