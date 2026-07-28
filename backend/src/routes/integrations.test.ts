import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createAIProvider, MockEmbeddingProvider, MockSpeechToTextProvider, MockTextToSpeechProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from '../app';
import { ActionLogger } from '../actionLog/logger';
import { ExecutionIntentMatcher } from '../execution/executionIntentMatcher';
import { ExecutionRegistry } from '../execution/registry';
import { ExecutionService } from '../execution/executionService';
import { GmailSaveDraftExecutor } from '../execution/executors/gmailSaveDraftExecutor';
import { GmailSendEmailExecutor } from '../execution/executors/gmailSendEmailExecutor';
import { GitHubCreateIssueExecutor } from '../execution/executors/githubCreateIssueExecutor';
import { GitHubCreatePullRequestExecutor } from '../execution/executors/githubCreatePullRequestExecutor';
import { BriefingService } from '../insights/briefingService';
import { ConversationIntelligenceService } from '../insights/conversationIntelligenceService';
import { TaskIntelligenceService } from '../insights/taskIntelligenceService';
import { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
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
import { OAuthService } from '../oauth/oauthService';
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
import { VoiceService } from '../voice/voiceService';
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
  const email = `integrations-route-test-${randomUUID()}@example.com`;
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

interface IntegrationSummaryBody {
  provider: string;
  enabled: boolean;
  status: string;
  displayName: string;
  capabilities: Array<{ actionType: string; tier: string }>;
  requiredCredentialFields: string[];
}

test('GET /api/workspaces/:id/integrations lists all three providers, disconnected by default, with capability+tier metadata', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as { integrations: IntegrationSummaryBody[] };
      assert.equal(body.integrations.length, 3);
      assert.ok(body.integrations.every((integration) => integration.enabled === false));

      const gmail = body.integrations.find((integration) => integration.provider === 'gmail')!;
      assert.equal(gmail.displayName, 'Gmail');
      assert.deepEqual(
        gmail.capabilities.map((c) => c.actionType).sort(),
        ['draft_gmail_email', 'read_email', 'send_email'],
      );
      assert.ok(gmail.capabilities.every((c) => c.tier === 'execute_with_approval'));
      assert.deepEqual(gmail.requiredCredentialFields, ['accessToken', 'refreshToken']);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../integrations/:provider/connect connects with valid credentials', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/github/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'gh-token' } }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { integration: IntegrationSummaryBody };
      assert.equal(body.integration.enabled, true);
      assert.equal(body.integration.status, 'connected');

      // Never leaked back to the client.
      assert.equal(JSON.stringify(body).includes('gh-token'), false);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../integrations/:provider/connect rejects missing credential fields', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'only-one' } }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /refreshToken/);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../integrations/:provider/connect rejects an unknown provider', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/slack/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'x' } }),
      });

      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('connect then disconnect then reconnect works end to end', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/calendar/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'a', refreshToken: 'b' } }),
      });

      const disconnectResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/integrations/calendar/disconnect`,
        { method: 'POST' },
      );
      assert.equal(disconnectResponse.status, 200);
      const disconnectBody = (await disconnectResponse.json()) as { integration: IntegrationSummaryBody };
      assert.equal(disconnectBody.integration.enabled, false);

      const reconnectResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/integrations/calendar/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: { accessToken: 'c', refreshToken: 'd' } }),
        },
      );
      assert.equal(reconnectResponse.status, 200);
      const reconnectBody = (await reconnectResponse.json()) as { integration: IntegrationSummaryBody };
      assert.equal(reconnectBody.integration.enabled, true);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../integrations/:provider/disconnect returns 404 for a provider never connected', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/disconnect`, {
        method: 'POST',
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../integrations/:provider/rotate replaces credentials for an already-connected integration', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/github/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'first' } }),
      });

      const rotateResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/github/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { accessToken: 'second' } }),
      });

      assert.equal(rotateResponse.status, 200);
      const body = (await rotateResponse.json()) as { integration: IntegrationSummaryBody };
      assert.equal(body.integration.status, 'connected');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET /api/workspaces/:id/integrations 404s for an unknown workspace', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/integrations`);
    assert.equal(response.status, 404);
  });
});
