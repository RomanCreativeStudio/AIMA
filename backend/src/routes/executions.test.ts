import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createAIProvider, MockEmbeddingProvider, MockSpeechToTextProvider, MockTextToSpeechProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from '../app';
import { MockAuthProvider } from '../auth/mockAuthProvider';
import { authHeader } from '../testUtils/auth';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AimaCoreService } from '../core/aimaCoreService';
import { ContextManager } from '../core/contextManager';
import { ConversationService } from '../conversation/conversationService';
import { VoiceService } from '../voice/voiceService';
import { DraftService } from '../drafts/draftService';
import { ExecutionIntentMatcher } from '../execution/executionIntentMatcher';
import { ExecutionRegistry } from '../execution/registry';
import { ExecutionService } from '../execution/executionService';
import { GmailSaveDraftExecutor } from '../execution/executors/gmailSaveDraftExecutor';
import { GmailSendEmailExecutor } from '../execution/executors/gmailSendEmailExecutor';
import { GitHubCreateIssueExecutor } from '../execution/executors/githubCreateIssueExecutor';
import { GitHubCreatePullRequestExecutor } from '../execution/executors/githubCreatePullRequestExecutor';
import { StubCalendarConnector } from '../integrations/connectors/calendarConnector';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import type { IntegrationConnector } from '../integrations/connectors/types';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import { OAuthService } from '../oauth/oauthService';
import type { IntegrationProvider } from '../integrations/types';
import { BriefingService } from '../insights/briefingService';
import { ConversationIntelligenceService } from '../insights/conversationIntelligenceService';
import { TaskIntelligenceService } from '../insights/taskIntelligenceService';
import { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
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
import { CreateGithubIssueDraftWorkflowHandler } from '../workflows/handlers/createGithubIssueDraftWorkflow';
import { DailyWorkspaceBriefingWorkflowHandler } from '../workflows/handlers/dailyWorkspaceBriefingWorkflow';
import { DraftEmailReplyWorkflowHandler } from '../workflows/handlers/draftEmailReplyWorkflow';
import { SummarizeUnreadEmailWorkflowHandler } from '../workflows/handlers/summarizeUnreadEmailWorkflow';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowIntentMatcher } from '../workflows/workflowIntentMatcher';
import { WorkflowService } from '../workflows/workflowService';
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
  const githubConnector = new StubGitHubConnector();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: gmailConnector,
    github: githubConnector,
    calendar: new StubCalendarConnector(),
  };
  const integrationService = new IntegrationService(pool, integrationRegistry, connectors, credentialEncryptor);
  const oauthService = new OAuthService(pool, {}, integrationService);
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
    draft_email_reply: new DraftEmailReplyWorkflowHandler(workflowRegistry.get('draft_email_reply')!, aiProvider, draftService),
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
  const executionRegistry = new ExecutionRegistry([
    new GmailSendEmailExecutor(gmailConnector),
    new GmailSaveDraftExecutor(gmailConnector),
    new GitHubCreateIssueExecutor(githubConnector),
    new GitHubCreatePullRequestExecutor(githubConnector),
  ]);
  const executionService = new ExecutionService(pool, executionRegistry, integrationService, approvalEngine, permissionEngine);
  const executionIntentMatcher = new ExecutionIntentMatcher(executionRegistry);
  const conversationService = new ConversationService({
    db: pool,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
    executionIntentMatcher,
  });
  const voiceService = new VoiceService(pool, conversationService, new MockSpeechToTextProvider(), new MockTextToSpeechProvider());

  const briefingService = new BriefingService(workspaceService, taskService, approvalEngine, workflowService, actionLogger);
  const taskIntelligenceService = new TaskIntelligenceService(taskService);
  const conversationIntelligenceService = new ConversationIntelligenceService(conversationService, memoryService, aiProvider);
  const workspaceInsightsService = new WorkspaceInsightsService(
    workspaceService,
    actionLogger,
    workflowService,
    approvalEngine,
    taskService,
  );

  const app = createApp({
    pool,
    registry,
    authProvider: new MockAuthProvider(),
    permissionEngine,
    actionLogger,
    integrationService,
    integrationRegistry,
    oauthService,
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
    briefingService,
    taskIntelligenceService,
    conversationIntelligenceService,
    workspaceInsightsService,
    executionService,
    voiceService,
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
  const email = `executions-route-test-${randomUUID()}@example.com`;
  const userResult = await pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
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

async function connectGmail(baseUrl: string, workspaceId: string, userId: string): Promise<void> {
  await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
    body: JSON.stringify({ credentials: { accessToken: 'a', refreshToken: 'b' } }),
  });
}

interface ExecutionBody {
  id: string;
  status: string;
  provider: string;
  actionType: string;
  pendingApprovalId: string | null;
  responseSummary: Record<string, unknown> | null;
  errorDetails: string | null;
}

test('POST .../executions/preview 400s for a malformed workspaceId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/executions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: {} }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../executions/preview reports requiresApproval and integrationConnected', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const before = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: { to: 'a@b.com' } }),
      });
      const beforeBody = (await before.json()) as { preview: { requiresApproval: boolean; integrationConnected: boolean } };
      assert.equal(beforeBody.preview.requiresApproval, true);
      assert.equal(beforeBody.preview.integrationConnected, false);

      await connectGmail(baseUrl, workspaceId, userId);
      const after = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: { to: 'a@b.com' } }),
      });
      const afterBody = (await after.json()) as { preview: { integrationConnected: boolean } };
      assert.equal(afterBody.preview.integrationConnected, true);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../executions/preview surfaces the connected integration\'s live tokenExpiresAt (Phase 2.7)', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const disconnected = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: {} }),
      });
      const disconnectedBody = (await disconnected.json()) as { preview: { tokenExpiresAt: string | null } };
      assert.equal(disconnectedBody.preview.tokenExpiresAt, null);

      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ credentials: { accessToken: 'a', refreshToken: 'b', expiresAt } }),
      });

      const connected = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: {} }),
      });
      const connectedBody = (await connected.json()) as { preview: { tokenExpiresAt: string | null } };
      assert.equal(connectedBody.preview.tokenExpiresAt, expiresAt);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../executions rejects an unregistered actionType with 400', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'launch_the_missiles', payload: {} }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../executions 404s when the integration is not connected', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: { to: 'a@b.com' } }),
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('full lifecycle: create -> awaiting_approval -> approve -> execute -> succeeded, then idempotent retry', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await connectGmail(baseUrl, workspaceId, userId);

      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' } }),
      });
      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as { execution: ExecutionBody };
      assert.equal(created.execution.status, 'awaiting_approval');
      const pendingApprovalId = created.execution.pendingApprovalId;
      assert.ok(pendingApprovalId);

      const executeBeforeApproval = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/executions/${created.execution.id}/execute`,
        { method: 'POST', headers: authHeader(userId) },
      );
      assert.equal(executeBeforeApproval.status, 409);

      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/${pendingApprovalId}/approve`, {
        method: 'POST',
        headers: authHeader(userId),
      });

      const executeResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/executions/${created.execution.id}/execute`,
        { method: 'POST', headers: authHeader(userId) },
      );
      const executed = (await executeResponse.json()) as { execution: ExecutionBody };
      assert.equal(executed.execution.status, 'succeeded');
      assert.ok(executed.execution.responseSummary?.messageId);

      const retryResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/executions/${created.execution.id}/execute`,
        { method: 'POST', headers: authHeader(userId) },
      );
      const retried = (await retryResponse.json()) as { execution: ExecutionBody };
      assert.equal(retried.execution.status, 'succeeded');
      assert.deepEqual(retried.execution.responseSummary, executed.execution.responseSummary);

      const detailResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions/${created.execution.id}`, {
        headers: authHeader(userId),
      });
      const detail = (await detailResponse.json()) as { execution: ExecutionBody };
      assert.equal(detail.execution.status, 'succeeded');

      const historyResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions`, {
        headers: authHeader(userId),
      });
      const history = (await historyResponse.json()) as { executions: ExecutionBody[] };
      assert.equal(history.executions.length, 1);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('rejected approval marks the execution failed', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await connectGmail(baseUrl, workspaceId, userId);
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: { to: 'a@b.com', subject: 's', body: 'b' } }),
      });
      const created = (await createResponse.json()) as { execution: ExecutionBody };

      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/approvals/${created.execution.pendingApprovalId}/reject`, {
        method: 'POST',
        headers: authHeader(userId),
      });

      const executeResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/executions/${created.execution.id}/execute`,
        { method: 'POST', headers: authHeader(userId) },
      );
      const executed = (await executeResponse.json()) as { execution: ExecutionBody };
      assert.equal(executed.execution.status, 'failed');
      assert.match(executed.execution.errorDetails ?? '', /rejected/);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../executions/:id 404s for an unknown execution, and enforces workspace isolation', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    const { userId: otherUserId, workspaceId: otherWorkspaceId } = await seedWorkspace(pool);
    try {
      const missing = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/executions/00000000-0000-0000-0000-000000000000`,
        { headers: authHeader(userId) },
      );
      assert.equal(missing.status, 404);

      await connectGmail(baseUrl, workspaceId, userId);
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ actionType: 'send_email', payload: { to: 'a@b.com', subject: 's', body: 'b' } }),
      });
      const created = (await createResponse.json()) as { execution: ExecutionBody };

      const crossWorkspace = await fetch(`${baseUrl}/api/workspaces/${otherWorkspaceId}/executions/${created.execution.id}`, {
        headers: authHeader(otherUserId),
      });
      assert.equal(crossWorkspace.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
      await cleanupWorkspace(pool, otherUserId);
    }
  });
});
