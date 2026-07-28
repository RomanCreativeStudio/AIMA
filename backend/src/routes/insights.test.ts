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
  const email = `insights-route-test-${randomUUID()}@example.com`;
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

async function seedConversation(pool: Pool, workspaceId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO conversations (workspace_id, title) VALUES ($1, $2) RETURNING id',
    [workspaceId, 'Test conversation'],
  );
  return result.rows[0].id;
}

async function cleanupWorkspace(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('GET .../briefing 404s for an unknown workspace', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/briefing`);
    assert.equal(response.status, 404);
  });
});

test('GET .../briefing 400s for a malformed workspaceId', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/briefing`);
    assert.equal(response.status, 400);
  });
});

test('GET .../briefing returns a well-formed daily briefing for a fresh workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/briefing`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        briefing: {
          workspaceId: string;
          workspaceName: string;
          pendingApprovalCount: number;
          activeWorkflowCount: number;
          priorityTasks: unknown[];
          recentActivity: unknown[];
        };
      };
      assert.equal(body.briefing.workspaceId, workspaceId);
      assert.equal(body.briefing.workspaceName, 'rcs');
      assert.equal(body.briefing.pendingApprovalCount, 0);
      assert.equal(body.briefing.activeWorkflowCount, 0);
      assert.deepEqual(body.briefing.priorityTasks, []);
      assert.deepEqual(body.briefing.recentActivity, []);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../task-intelligence buckets due-soon and overdue tasks created through the real tasks route', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const overdueDueDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Late thing', dueDate: overdueDueDate }),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/task-intelligence`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        taskIntelligence: { overdue: Array<{ title: string }>; suggestedPriorities: unknown[] };
      };
      assert.equal(body.taskIntelligence.overdue.length, 1);
      assert.equal(body.taskIntelligence.overdue[0].title, 'Late thing');
      assert.equal(body.taskIntelligence.suggestedPriorities.length, 1);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../conversations/:id/intelligence 404s for an unknown conversation', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/conversations/00000000-0000-0000-0000-000000000000/intelligence`,
      );
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../conversations/:id/intelligence summarizes real conversation history', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const conversationId = await seedConversation(pool, workspaceId);
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'What should I tell Acme about the timeline?' }),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/conversations/${conversationId}/intelligence`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        conversationIntelligence: { summary: string; recentContext: unknown[]; suggestedFollowUps: string[] };
      };
      assert.ok(body.conversationIntelligence.summary.length > 0);
      assert.equal(body.conversationIntelligence.recentContext.length, 2);
      assert.ok(body.conversationIntelligence.suggestedFollowUps.length > 0);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../insights aggregates metrics scoped to the workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'A task' }),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/insights`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        insights: {
          workspaceId: string;
          taskMetrics: { total: number; completionRate: number };
          workflowMetrics: { totalRuns: number };
          approvalMetrics: { total: number };
          activityMetrics: { totalActions: number };
        };
      };
      assert.equal(body.insights.workspaceId, workspaceId);
      assert.equal(body.insights.taskMetrics.total, 1);
      assert.equal(body.insights.taskMetrics.completionRate, 0);
      assert.equal(body.insights.workflowMetrics.totalRuns, 0);
      assert.equal(body.insights.approvalMetrics.total, 0);
      assert.equal(body.insights.activityMetrics.totalActions, 1, 'creating a task logs one action');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../insights 404s for an unknown workspace', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/insights`);
    assert.equal(response.status, 404);
  });
});
