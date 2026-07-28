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
import { CreateGithubIssueDraftWorkflowHandler } from '../workflows/handlers/createGithubIssueDraftWorkflow';
import { DailyWorkspaceBriefingWorkflowHandler } from '../workflows/handlers/dailyWorkspaceBriefingWorkflow';
import { DraftEmailReplyWorkflowHandler } from '../workflows/handlers/draftEmailReplyWorkflow';
import { SummarizeUnreadEmailWorkflowHandler } from '../workflows/handlers/summarizeUnreadEmailWorkflow';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowIntentMatcher } from '../workflows/workflowIntentMatcher';
import { WorkflowService } from '../workflows/workflowService';
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
import { syncCapabilitiesToDatabase } from '../permissions/syncCapabilities';

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
  await syncCapabilitiesToDatabase(pool, registry);
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(pool);
  const memoryService = new MemoryService(pool, new MockEmbeddingProvider());
  const documentService = new DocumentService(pool, new MockEmbeddingProvider());
  const taskService = new TaskService(pool);
  const draftService = new DraftService(pool);
  const integrationRegistry = new IntegrationRegistry();
  const credentialEncryptor = new AesGcmCredentialEncryptor(TEST_CREDENTIAL_ENCRYPTION_KEY);
  const gmailConnector = new StubGmailConnector();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: gmailConnector,
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
  const workflowRegistry = new WorkflowRegistry();
  const workflowHandlers: Record<WorkflowKey, WorkflowHandler> = {
    draft_email_reply: new DraftEmailReplyWorkflowHandler(
      workflowRegistry.get('draft_email_reply')!,
      aiProvider,
      draftService,
    ),
    create_github_issue_draft: new CreateGithubIssueDraftWorkflowHandler(
      workflowRegistry.get('create_github_issue_draft')!,
      aiProvider,
      draftService,
    ),
    summarize_unread_email: new SummarizeUnreadEmailWorkflowHandler(
      workflowRegistry.get('summarize_unread_email')!,
      aiProvider,
      integrationService,
      gmailConnector,
    ),
    daily_workspace_briefing: new DailyWorkspaceBriefingWorkflowHandler(
      workflowRegistry.get('daily_workspace_briefing')!,
      aiProvider,
      taskService,
      approvalEngine,
      healthService,
    ),
  };
  const workflowService = new WorkflowService(pool, workflowRegistry, workflowHandlers, approvalEngine);
  const workflowIntentMatcher = new WorkflowIntentMatcher(workflowRegistry);
  const conversationService = new ConversationService({
    db: pool,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
  });

  const app = createApp({
    pool,
    registry,
    permissionEngine,
    actionLogger,
    integrationService,
    integrationRegistry,
    workflowService,
    workflowRegistry,
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
  const email = `workflows-route-test-${randomUUID()}@example.com`;
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

interface WorkflowRunBody {
  id: string;
  status: string;
  currentStepIndex: number;
  steps: Array<{ stepIndex: number; stepKey: string; status: string; pendingApprovalId: string | null }>;
}

test('GET /api/workflows lists the four built-in workflow definitions', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workflows`);
    assert.equal(response.status, 200);

    const body = (await response.json()) as { workflows: Array<{ key: string }> };
    assert.equal(body.workflows.length, 4);
    assert.ok(body.workflows.some((workflow) => workflow.key === 'summarize_unread_email'));
  });
});

test('POST .../workflow-runs creates a run; GET lists and fetches it', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowKey: 'daily_workspace_briefing', input: {} }),
      });
      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as { run: WorkflowRunBody };
      assert.equal(created.run.status, 'pending');
      assert.equal(created.run.steps.length, 2);

      const listResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs`);
      const listed = (await listResponse.json()) as { runs: WorkflowRunBody[] };
      assert.equal(listed.runs.length, 1);

      const getResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}`);
      const fetched = (await getResponse.json()) as { run: WorkflowRunBody };
      assert.equal(fetched.run.id, created.run.id);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../workflow-runs rejects an unknown workflowKey', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowKey: 'send_all_my_money', input: {} }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../execute advances one step; running to completion takes multiple calls', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowKey: 'daily_workspace_briefing', input: {} }),
      });
      const created = (await createResponse.json()) as { run: WorkflowRunBody };

      const step1Response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/execute`,
        { method: 'POST' },
      );
      const afterStep1 = (await step1Response.json()) as { run: WorkflowRunBody };
      assert.equal(afterStep1.run.status, 'running');
      assert.equal(afterStep1.run.currentStepIndex, 1);

      const step2Response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/execute`,
        { method: 'POST' },
      );
      const afterStep2 = (await step2Response.json()) as { run: WorkflowRunBody };
      assert.equal(afterStep2.run.status, 'completed');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('a Tier 3 gated step pauses at awaiting_approval, then resume completes it after approval', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'a', refreshToken: 'b' } }),
      });

      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowKey: 'summarize_unread_email', input: {} }),
      });
      const created = (await createResponse.json()) as { run: WorkflowRunBody };

      const executeResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/execute`,
        { method: 'POST' },
      );
      const awaiting = (await executeResponse.json()) as { run: WorkflowRunBody };
      assert.equal(awaiting.run.status, 'awaiting_approval');
      const pendingApprovalId = awaiting.run.steps[0].pendingApprovalId;
      assert.ok(pendingApprovalId);

      const resumeBeforeApproval = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/resume`,
        { method: 'POST' },
      );
      assert.equal(resumeBeforeApproval.status, 409);

      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/${pendingApprovalId}/approve`, { method: 'POST' });

      const resumeResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/resume`,
        { method: 'POST' },
      );
      const afterResume = (await resumeResponse.json()) as { run: WorkflowRunBody };
      assert.equal(afterResume.run.status, 'running');
      assert.equal(afterResume.run.steps[0].status, 'completed');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('pause then cancel a run', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowKey: 'daily_workspace_briefing', input: {} }),
      });
      const created = (await createResponse.json()) as { run: WorkflowRunBody };

      const pauseResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/pause`,
        { method: 'POST' },
      );
      const paused = (await pauseResponse.json()) as { run: WorkflowRunBody };
      assert.equal(paused.run.status, 'paused');

      const cancelResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/cancel`,
        { method: 'POST' },
      );
      const cancelled = (await cancelResponse.json()) as { run: WorkflowRunBody };
      assert.equal(cancelled.run.status, 'cancelled');

      const secondCancel = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/${created.run.id}/cancel`,
        { method: 'POST' },
      );
      assert.equal(secondCancel.status, 409);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../workflow-runs/:id 404s for an unknown run', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/workflow-runs/00000000-0000-0000-0000-000000000000`,
      );
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});
