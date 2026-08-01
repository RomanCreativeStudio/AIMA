import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createAIProvider, MockEmbeddingProvider, MockSpeechToTextProvider, MockTextToSpeechProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from '../app';
import { MockAuthProvider, mockPasswordFor, mockSubjectIdFor } from '../auth/mockAuthProvider';
import { SessionService } from '../auth/sessionService';
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
  const authProvider = new MockAuthProvider();
  const sessionService = new SessionService(pool, authProvider);
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
    authProvider,
    sessionService,
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

/** Seeds a `users` row whose id is `mockSubjectIdFor(email)`, so `MockAuthProvider.signInWithPassword` resolves to a real, pre-existing local user (mirrors the FK `auth_sessions.user_id` -> `users.id` requires). */
async function seedLoginableUser(pool: Pool): Promise<{ email: string; password: string; userId: string }> {
  const email = `auth-route-test-${randomUUID()}@example.com`;
  const userId = mockSubjectIdFor(email);
  await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, email]);
  return { email, password: mockPasswordFor(email), userId };
}

async function cleanupUser(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('POST /api/auth/login succeeds with valid credentials and creates a session', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { email, password, userId } = await seedLoginableUser(pool);
    try {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceLabel: 'Test Device' }),
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as {
        tokens: { accessToken: string; refreshToken: string };
        session: { id: string; userId: string; deviceLabel: string | null };
      };
      assert.ok(body.tokens.accessToken);
      assert.ok(body.tokens.refreshToken);
      assert.equal(body.session.userId, userId);
      assert.equal(body.session.deviceLabel, 'Test Device');
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/auth/login rejects an unknown email with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'irrelevant' }),
    });
    assert.equal(response.status, 401);
  });
});

test('POST /api/auth/login rejects a wrong password with 401', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { email, userId } = await seedLoginableUser(pool);
    try {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'definitely-wrong' }),
      });
      assert.equal(response.status, 401);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/auth/login rejects a malformed email with 400', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'x' }),
    });
    assert.equal(response.status, 400);
  });
});

test('POST /api/auth/refresh returns a rotated token pair for a valid refresh token', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { email, password, userId } = await seedLoginableUser(pool);
    try {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const { tokens } = (await loginResponse.json()) as { tokens: { refreshToken: string } };

      const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      assert.equal(refreshResponse.status, 200);
      const refreshed = (await refreshResponse.json()) as { tokens: { refreshToken: string; accessToken: string } };
      assert.notEqual(refreshed.tokens.refreshToken, tokens.refreshToken);
      assert.ok(refreshed.tokens.accessToken);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/auth/refresh detects reuse of an already-rotated refresh token', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { email, password, userId } = await seedLoginableUser(pool);
    try {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const { tokens } = (await loginResponse.json()) as { tokens: { refreshToken: string } };

      await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      const reuseResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      assert.equal(reuseResponse.status, 401);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/auth/refresh rejects an unrecognized refresh token with 401', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'garbage' }),
    });
    assert.equal(response.status, 401);
  });
});

test('POST /api/auth/logout revokes the session so its refresh token can no longer be used', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { email, password, userId } = await seedLoginableUser(pool);
    try {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const { tokens } = (await loginResponse.json()) as { tokens: { accessToken: string; refreshToken: string } };

      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.accessToken}` },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      assert.equal(logoutResponse.status, 204);

      const refreshAfterLogout = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      assert.equal(refreshAfterLogout.status, 401);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('POST /api/auth/logout does not revoke other sessions unless allSessions is explicitly requested', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { email, password, userId } = await seedLoginableUser(pool);
    try {
      const loginA = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceLabel: 'Device A' }),
      });
      const { tokens: tokensA } = (await loginA.json()) as { tokens: { accessToken: string; refreshToken: string } };

      const loginB = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceLabel: 'Device B' }),
      });
      const { tokens: tokensB } = (await loginB.json()) as { tokens: { refreshToken: string } };

      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokensA.accessToken}` },
        body: JSON.stringify({ refreshToken: tokensA.refreshToken }),
      });
      assert.equal(logoutResponse.status, 204);

      const refreshB = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokensB.refreshToken }),
      });
      assert.equal(refreshB.status, 200);
    } finally {
      await cleanupUser(pool, userId);
    }
  });
});

test('GET /api/auth/sessions lists only the authenticated caller\'s sessions', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedLoginableUser(pool);
    const b = await seedLoginableUser(pool);
    try {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: a.email, password: a.password }),
      });
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: b.email, password: b.password }),
      });

      const response = await fetch(`${baseUrl}/api/auth/sessions`, { headers: authHeader(a.userId) });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { sessions: Array<{ userId: string }> };
      assert.equal(body.sessions.length, 1);
      assert.equal(body.sessions[0].userId, a.userId);
    } finally {
      await cleanupUser(pool, a.userId);
      await cleanupUser(pool, b.userId);
    }
  });
});

test('GET /api/auth/sessions returns 401 with no Authorization header', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/sessions`);
    assert.equal(response.status, 401);
  });
});

test('DELETE /api/auth/sessions/:sessionId returns 404 for a session owned by a different user', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const owner = await seedLoginableUser(pool);
    const intruder = await seedLoginableUser(pool);
    try {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: owner.email, password: owner.password }),
      });
      const { session } = (await loginResponse.json()) as { session: { id: string } };

      const response = await fetch(`${baseUrl}/api/auth/sessions/${session.id}`, {
        method: 'DELETE',
        headers: authHeader(intruder.userId),
      });
      assert.equal(response.status, 404);

      const ownerResponse = await fetch(`${baseUrl}/api/auth/sessions/${session.id}`, {
        method: 'DELETE',
        headers: authHeader(owner.userId),
      });
      assert.equal(ownerResponse.status, 204);
    } finally {
      await cleanupUser(pool, owner.userId);
      await cleanupUser(pool, intruder.userId);
    }
  });
});

test('DELETE /api/auth/sessions/:sessionId returns 400 for a non-UUID sessionId', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/sessions/not-a-uuid`, {
      method: 'DELETE',
      headers: authHeader('00000000-0000-0000-0000-000000000001'),
    });
    assert.equal(response.status, 400);
  });
});
