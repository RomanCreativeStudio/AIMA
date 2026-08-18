import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createAIProvider, MockEmbeddingProvider, MockSpeechToTextProvider, MockTextToSpeechProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from '../app';
import { MockAuthProvider, issueMockTokens } from '../auth/mockAuthProvider';
import { authHeader } from '../testUtils/auth';
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

async function seedUser(pool: Pool): Promise<string> {
  const email = `workspace-route-test-${randomUUID()}@example.com`;
  const result = await pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
  return result.rows[0].id;
}

async function cleanupUser(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('POST /api/workspaces creates a workspace owned by the authenticated caller, with a defaulted type', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const userId = await seedUser(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ slug: 'mfs', name: 'Mythic Forge Studios' }),
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as { workspace: { slug: string; type: string; userId: string } };
      assert.equal(body.workspace.slug, 'mfs');
      assert.equal(body.workspace.type, 'creative');
      assert.equal(body.workspace.userId, userId);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/workspaces ignores a client-supplied userId and uses the authenticated caller instead', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const userId = await seedUser(pool);
    const someoneElsesId = '00000000-0000-0000-0000-000000000000';
    try {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ userId: someoneElsesId, slug: 'personal', name: 'Personal' }),
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as { workspace: { userId: string } };
      assert.equal(body.workspace.userId, userId);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/workspaces rejects an invalid slug', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const userId = await seedUser(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ slug: 'not-a-real-slug', name: 'x' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/workspaces rejects a caller whose id has no user row with 404', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader('00000000-0000-0000-0000-000000000000') },
      body: JSON.stringify({ slug: 'personal', name: 'x' }),
    });
    assert.equal(response.status, 404);
  });
});

test('POST /api/workspaces rejects a request with no Authorization header with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'personal', name: 'x' }),
    });
    assert.equal(response.status, 401);
  });
});

test('POST /api/workspaces rejects an invalid access token with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ slug: 'personal', name: 'x' }),
    });
    assert.equal(response.status, 401);
  });
});

test('POST /api/workspaces rejects an expired access token with 401', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const userId = await seedUser(pool);
    try {
      const expiredToken = issueMockTokens(userId, -1000).accessToken;
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${expiredToken}` },
        body: JSON.stringify({ slug: 'personal', name: 'x' }),
      });
      assert.equal(response.status, 401);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/workspaces rejects a duplicate slug for the same user with 409', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const userId = await seedUser(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ slug: 'personal', name: 'Personal' }),
      });
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ slug: 'personal', name: 'Personal Again' }),
      });
      assert.equal(response.status, 409);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('GET /api/users/:id/workspaces lists only that user\'s workspaces', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedUser(pool);
    const b = await seedUser(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(a) },
        body: JSON.stringify({ slug: 'personal', name: 'A Personal' }),
      });
      await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(b) },
        body: JSON.stringify({ slug: 'personal', name: 'B Personal' }),
      });

      const response = await fetch(`${baseUrl}/api/users/${a}/workspaces`, { headers: authHeader(a) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { workspaces: Array<{ userId: string }> };
      assert.equal(body.workspaces.length, 1);
      assert.equal(body.workspaces[0].userId, a);
    } finally {
      await cleanupUser(pool, a);
      await cleanupUser(pool, b);
    }
  });
});

test('GET /api/users/:id/workspaces returns 404 when the caller requests another user\'s list', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedUser(pool);
    const b = await seedUser(pool);
    try {
      const response = await fetch(`${baseUrl}/api/users/${a}/workspaces`, { headers: authHeader(b) });
      assert.equal(response.status, 404);
    } finally {
      await cleanupUser(pool, a);
      await cleanupUser(pool, b);
    }
  });
});

test('GET /api/workspaces/:id returns 404 for an unknown id', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000`, {
      headers: authHeader('00000000-0000-0000-0000-000000000001'),
    });
    assert.equal(response.status, 404);
  });
});

test('GET /api/workspaces/:id returns 401 with no Authorization header', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000`);
    assert.equal(response.status, 401);
  });
});

test('GET /api/workspaces/:id returns 404 when requested by a caller who does not own it (cross-user access)', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const owner = await seedUser(pool);
    const intruder = await seedUser(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(owner) },
        body: JSON.stringify({ slug: 'rcs', name: 'RCS' }),
      });
      const { workspace } = (await createResponse.json()) as { workspace: { id: string } };

      const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, { headers: authHeader(intruder) });
      assert.equal(response.status, 404);

      const ownerResponse = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, { headers: authHeader(owner) });
      assert.equal(ownerResponse.status, 200);
    } finally {
      await cleanupUser(pool, owner);
      await cleanupUser(pool, intruder);
    }
  });
});

test('PATCH /api/workspaces/:id updates instructions and assistantBehavior', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const userId = await seedUser(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ slug: 'rcs', name: 'RCS' }),
      });
      const { workspace } = (await createResponse.json()) as { workspace: { id: string } };

      const updateResponse = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({
          instructions: 'Always mention the project deadline.',
          assistantBehavior: { tone: 'formal' },
        }),
      });

      assert.equal(updateResponse.status, 200);
      const updated = (await updateResponse.json()) as {
        workspace: { instructions: string; assistantBehavior: Record<string, unknown> };
      };
      assert.equal(updated.workspace.instructions, 'Always mention the project deadline.');
      assert.deepEqual(updated.workspace.assistantBehavior, { tone: 'formal' });
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('PATCH /api/workspaces/:id returns 404 for an unknown id', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader('00000000-0000-0000-0000-000000000001') },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(response.status, 404);
  });
});

test('PATCH /api/workspaces/:id returns 404 when the caller does not own it (cross-user access)', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const owner = await seedUser(pool);
    const intruder = await seedUser(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(owner) },
        body: JSON.stringify({ slug: 'development', name: 'Dev' }),
      });
      const { workspace } = (await createResponse.json()) as { workspace: { id: string } };

      const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(intruder) },
        body: JSON.stringify({ name: 'Hijacked' }),
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupUser(pool, owner);
      await cleanupUser(pool, intruder);
    }
  });
});
