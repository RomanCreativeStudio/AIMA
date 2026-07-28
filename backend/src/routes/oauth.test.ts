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
import type { IntegrationProvider } from '../integrations/types';
import { OAuthService } from '../oauth/oauthService';
import type { OAuthProvider, OAuthTokenSet } from '../oauth/types';
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

/** A test double `OAuthProvider` (Phase 2.7) — no real network, deterministic tokens, records exchanged codes. */
class FakeOAuthProvider implements OAuthProvider {
  exchangedCodes: string[] = [];
  shouldFailExchange = false;

  constructor(
    readonly provider: IntegrationProvider,
    private readonly tokens: OAuthTokenSet,
  ) {}

  getAuthorizationUrl(state: string): string {
    return `https://example.test/${this.provider}/authorize?state=${state}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokenSet> {
    if (this.shouldFailExchange) {
      throw new Error('provider rejected the code');
    }
    this.exchangedCodes.push(code);
    return this.tokens;
  }

  async refreshAccessToken(): Promise<OAuthTokenSet> {
    return this.tokens;
  }

  async revokeToken(): Promise<void> {}
}

async function withTestServer(fn: (baseUrl: string, pool: Pool, gmailOAuth: FakeOAuthProvider) => Promise<void>): Promise<void> {
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
  const gmailOAuth = new FakeOAuthProvider('gmail', {
    accessToken: 'fresh-access',
    refreshToken: 'fresh-refresh',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const oauthProviders: Partial<Record<IntegrationProvider, OAuthProvider>> = { gmail: gmailOAuth };
  const integrationService = new IntegrationService(pool, integrationRegistry, connectors, credentialEncryptor, oauthProviders);
  const oauthService = new OAuthService(pool, oauthProviders, integrationService);
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
    create_github_issue_draft: new CreateGithubIssueDraftWorkflowHandler(workflowRegistry.get('create_github_issue_draft')!, aiProvider, draftService),
    summarize_unread_email: new SummarizeUnreadEmailWorkflowHandler(workflowRegistry.get('summarize_unread_email')!, aiProvider, integrationService, gmailConnector),
    daily_workspace_briefing: new DailyWorkspaceBriefingWorkflowHandler(workflowRegistry.get('daily_workspace_briefing')!, aiProvider, taskService, approvalEngine, healthService),
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
  const workspaceInsightsService = new WorkspaceInsightsService(workspaceService, actionLogger, workflowService, approvalEngine, taskService);

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
    await fn(baseUrl, pool, gmailOAuth);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

async function seedWorkspace(pool: Pool): Promise<SeededWorkspace> {
  const email = `oauth-route-test-${randomUUID()}@example.com`;
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

test('POST /api/workspaces/:id/integrations/:provider/oauth/start returns an authorizationUrl', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/oauth/start`, { method: 'POST' });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { authorizationUrl: string };
      assert.match(body.authorizationUrl, /^https:\/\/example\.test\/gmail\/authorize\?state=/);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../oauth/start rejects an unknown provider or malformed workspaceId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const badProvider = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/not-a-provider/oauth/start`, { method: 'POST' });
      assert.equal(badProvider.status, 400);

      const badWorkspace = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/integrations/gmail/oauth/start`, { method: 'POST' });
      assert.equal(badWorkspace.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../oauth/start returns 404 for an unknown workspace', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/integrations/gmail/oauth/start`, { method: 'POST' });
    assert.equal(response.status, 404);
  });
});

test('GET /api/oauth/:provider/callback completes the connection and renders a success page', async () => {
  await withTestServer(async (baseUrl, pool, gmailOAuth) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const startResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations/gmail/oauth/start`, { method: 'POST' });
      const { authorizationUrl } = (await startResponse.json()) as { authorizationUrl: string };
      const state = new URL(authorizationUrl).searchParams.get('state')!;

      const callbackResponse = await fetch(`${baseUrl}/api/oauth/gmail/callback?code=the-code&state=${state}`);

      assert.equal(callbackResponse.status, 200);
      const html = await callbackResponse.text();
      assert.match(html, /Connected/i);
      assert.deepEqual(gmailOAuth.exchangedCodes, ['the-code']);

      const integrationsResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/integrations`);
      const { integrations } = (await integrationsResponse.json()) as { integrations: Array<{ provider: string; enabled: boolean }> };
      const gmail = integrations.find((integration) => integration.provider === 'gmail')!;
      assert.equal(gmail.enabled, true);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../oauth/:provider/callback renders an error page for an invalid/expired state', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/oauth/gmail/callback?code=x&state=not-a-real-state`);

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /invalid|expired/i);
  });
});

test('GET .../oauth/:provider/callback renders an error page when the provider itself reports an error (e.g. the user declined consent)', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/oauth/gmail/callback?error=access_denied&state=whatever`);

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /declined/i);
  });
});

test('GET .../oauth/:provider/callback renders an error page for an unknown provider', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/oauth/not-a-provider/callback?code=x&state=y`);

    assert.equal(response.status, 400);
  });
});
