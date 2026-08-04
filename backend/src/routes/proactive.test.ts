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
import { ExecutionIntentMatcher } from '../execution/executionIntentMatcher';
import { ExecutionRegistry } from '../execution/registry';
import { ExecutionService } from '../execution/executionService';
import { GmailSaveDraftExecutor } from '../execution/executors/gmailSaveDraftExecutor';
import { GmailSendEmailExecutor } from '../execution/executors/gmailSendEmailExecutor';
import { GitHubCreateIssueExecutor } from '../execution/executors/githubCreateIssueExecutor';
import { GitHubCreatePullRequestExecutor } from '../execution/executors/githubCreatePullRequestExecutor';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AimaCoreService } from '../core/aimaCoreService';
import { ContextManager } from '../core/contextManager';
import { ConversationService } from '../conversation/conversationService';
import { VoiceService } from '../voice/voiceService';
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
import { BriefingService } from '../insights/briefingService';
import { ConversationIntelligenceService } from '../insights/conversationIntelligenceService';
import { TaskIntelligenceService } from '../insights/taskIntelligenceService';
import { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PatternDetectionService } from '../proactive/patternDetectionService';
import { ProactiveIntelligenceService } from '../proactive/proactiveIntelligenceService';
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

  const patternDetectionService = new PatternDetectionService(
    workspaceService,
    taskService,
    workflowService,
    approvalEngine,
    actionLogger,
    memoryService,
  );
  const proactiveIntelligenceService = new ProactiveIntelligenceService(
    patternDetectionService,
    memoryService,
    integrationService,
    integrationRegistry,
    workspaceService,
    actionLogger,
  );

  const briefingService = new BriefingService(
    workspaceService,
    taskService,
    approvalEngine,
    workflowService,
    actionLogger,
    memoryService,
    proactiveIntelligenceService,
  );
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
    proactiveIntelligenceService,
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
  const email = `proactive-route-test-${randomUUID()}@example.com`;
  const userResult = await pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
  const userId = userResult.rows[0].id;

  const workspaceResult = await pool.query<{ id: string }>(
    'INSERT INTO workspaces (user_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
    [userId, 'development', 'development'],
  );

  return { userId, workspaceId: workspaceResult.rows[0].id };
}

async function cleanupWorkspace(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('GET .../proactive/patterns returns an empty-but-valid pattern list for a fresh workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/patterns`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 200);

      const body = (await response.json()) as { patterns: Array<{ type: string }> };
      assert.ok(body.patterns.some((p) => p.type === 'activity_trend'));
      assert.ok(body.patterns.some((p) => p.type === 'memory_usage_trend'));
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../proactive/patterns rejects a malformed workspaceId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/proactive/patterns`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../proactive/patterns 404s for an unknown workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/proactive/patterns`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../proactive/suggestions recommends connecting unconnected integrations, scoped to the workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/suggestions`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        suggestions: Array<{ workspaceId: string; type: string; source: string }>;
      };
      assert.ok(body.suggestions.every((s) => s.workspaceId === workspaceId));
      assert.ok(body.suggestions.some((s) => s.type === 'integration' && s.source === 'integration_not_connected'));
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../proactive/suggestions rejects a malformed workspaceId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/proactive/suggestions`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../proactive/suggestions 404s for an unknown workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(
        `${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/proactive/suggestions`,
        { headers: authHeader(userId) },
      );
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

// Nudge Learning Loop sprint: POST .../proactive/suggestions/dismiss and .../act.

test('POST .../proactive/suggestions/dismiss records the interaction and suppresses the suggestion on the next GET', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await pool.query(
        "INSERT INTO tasks (workspace_id, title, status, due_date) VALUES ($1, 'Overdue task', 'todo', now() - interval '1 day')",
        [workspaceId],
      );
      const before = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/suggestions`, { headers: authHeader(userId) });
      const beforeBody = (await before.json()) as { suggestions: Array<{ source: string }> };
      assert.ok(beforeBody.suggestions.some((s) => s.source === 'missed_deadline_pattern'));

      const dismissResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/suggestions/dismiss`, {
        method: 'POST',
        headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: 'task:missed-deadlines', source: 'missed_deadline_pattern' }),
      });
      assert.equal(dismissResponse.status, 200);
      const dismissBody = (await dismissResponse.json()) as { recorded: boolean };
      assert.equal(dismissBody.recorded, true);

      const after = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/suggestions`, { headers: authHeader(userId) });
      const afterBody = (await after.json()) as { suggestions: Array<{ source: string }> };
      assert.ok(!afterBody.suggestions.some((s) => s.source === 'missed_deadline_pattern'));
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../proactive/suggestions/act records the interaction', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/suggestions/act`, {
        method: 'POST',
        headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: 'task:blocked-stale', source: 'blocked_task_stale_pattern' }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { recorded: boolean };
      assert.equal(body.recorded, true);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../proactive/suggestions/dismiss rejects a missing suggestionId/source', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/proactive/suggestions/dismiss`, {
        method: 'POST',
        headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: 'task:missed-deadlines' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../proactive/suggestions/dismiss rejects a malformed workspaceId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/proactive/suggestions/dismiss`, {
        method: 'POST',
        headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: 'task:missed-deadlines', source: 'missed_deadline_pattern' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../proactive/suggestions/dismiss 404s for an unknown workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(
        `${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/proactive/suggestions/dismiss`,
        {
          method: 'POST',
          headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId: 'task:missed-deadlines', source: 'missed_deadline_pattern' }),
        },
      );
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});
