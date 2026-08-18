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
  const email = `route-test-${randomUUID()}@example.com`;
  const userResult = await pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [
    email,
  ]);
  const userId = userResult.rows[0].id;

  const workspaceResult = await pool.query<{ id: string }>(
    'INSERT INTO workspaces (user_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
    [userId, 'development', 'development'],
  );

  return { userId, workspaceId: workspaceResult.rows[0].id };
}

async function cleanupWorkspace(pool: Pool, userId: string): Promise<void> {
  // ON DELETE CASCADE on workspaces/memory_records/action_log takes care of the rest.
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

test('POST /api/workspaces/:id/memories creates a memory, evaluates its tier, and logs the action', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ scope: 'workspace', content: 'Client Acme wants a full redesign.' }),
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as { memory: { scope: string }; permission: { kind: string } };
      assert.equal(body.memory.scope, 'workspace');
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

test('POST /api/workspaces/:id/memories rejects a well-formed but unknown workspaceId with 404, not 500', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ scope: 'workspace', content: 'x' }),
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST /api/workspaces/:id/memories rejects a request with no Authorization header with 401', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'workspace', content: 'x' }),
      });
      assert.equal(response.status, 401);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST /api/workspaces/:id/memories rejects a caller who does not own the workspace with 404', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const owner = await seedWorkspace(pool);
    const intruder = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${owner.workspaceId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(intruder.userId) },
        body: JSON.stringify({ scope: 'workspace', content: 'x' }),
      });
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, owner.userId);
      await cleanupWorkspace(pool, intruder.userId);
    }
  });
});

test('POST .../memories rejects scope="conversation" without a conversationId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ scope: 'conversation', content: 'missing id' }),
      });

      assert.equal(response.status, 400);

      const log = await pool.query('SELECT 1 FROM action_log WHERE workspace_id = $1', [workspaceId]);
      assert.equal(log.rows.length, 0, 'a rejected request should never reach the action log');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../memories rejects a malformed workspaceId', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/not-a-uuid/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ scope: 'workspace', content: 'x' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../memories/search returns ranked results scoped to the requesting workspace only', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(a.userId) },
        body: JSON.stringify({ scope: 'workspace', content: 'Acme wants a website redesign.' }),
      });
      await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(b.userId) },
        body: JSON.stringify({ scope: 'workspace', content: 'Kestrel character backstory notes.' }),
      });

      const response = await fetch(
        `${baseUrl}/api/workspaces/${a.workspaceId}/memories/search?q=${encodeURIComponent('Acme redesign')}`,
        { headers: authHeader(a.userId) },
      );
      assert.equal(response.status, 200);

      const body = (await response.json()) as { results: Array<{ workspaceId: string }> };
      assert.ok(body.results.length >= 1);
      assert.ok(body.results.every((result) => result.workspaceId === a.workspaceId));
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('GET .../memories/search requires a non-empty "q" parameter', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/search`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

async function createMemory(baseUrl: string, workspaceId: string, userId: string, content: string): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
    body: JSON.stringify({ scope: 'workspace', content }),
  });
  const body = (await response.json()) as { memory: { id: string } };
  return body.memory;
}

test('GET .../memories lists newest-first and excludes archived by default', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const first = await createMemory(baseUrl, workspaceId, userId, 'First memory.');
      const second = await createMemory(baseUrl, workspaceId, userId, 'Second memory.');
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${first.id}/archive`, {
        method: 'POST',
        headers: authHeader(userId),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories`, {
        headers: authHeader(userId),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { memories: Array<{ id: string }> };
      assert.deepEqual(
        body.memories.map((m) => m.id),
        [second.id],
      );

      const withArchived = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories?includeArchived=true`, {
        headers: authHeader(userId),
      });
      const withArchivedBody = (await withArchived.json()) as { memories: unknown[] };
      assert.equal(withArchivedBody.memories.length, 2);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../memories does not leak another workspace\'s memories', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      await createMemory(baseUrl, a.workspaceId, a.userId, 'Workspace A memory.');
      await createMemory(baseUrl, b.workspaceId, b.userId, 'Workspace B memory.');

      const response = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/memories`, {
        headers: authHeader(a.userId),
      });
      const body = (await response.json()) as { memories: Array<{ workspaceId: string }> };
      assert.equal(body.memories.length, 1);
      assert.equal(body.memories[0].workspaceId, a.workspaceId);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('PATCH .../memories/:id updates content and scores', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const memory = await createMemory(baseUrl, workspaceId, userId, 'Original content.');

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ content: 'Updated content.', importanceScore: 0.9 }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { memory: { content: string; importanceScore: number } };
      assert.equal(body.memory.content, 'Updated content.');
      assert.equal(body.memory.importanceScore, 0.9);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('PATCH .../memories/:id rejects an out-of-range score and an empty body', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const memory = await createMemory(baseUrl, workspaceId, userId, 'Some content.');

      const badScore = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({ confidenceScore: 2 }),
      });
      assert.equal(badScore.status, 400);

      const empty = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
        body: JSON.stringify({}),
      });
      assert.equal(empty.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('PATCH .../memories/:id returns 404 for an unknown memory id', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/memories/00000000-0000-0000-0000-000000000000`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
          body: JSON.stringify({ content: 'x' }),
        },
      );
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../memories/:id/archive archives a memory and excludes it from listing', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const memory = await createMemory(baseUrl, workspaceId, userId, 'Archive candidate.');

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${memory.id}/archive`, {
        method: 'POST',
        headers: authHeader(userId),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { memory: { archivedAt: string | null } };
      assert.ok(body.memory.archivedAt !== null);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('DELETE .../memories/:id permanently removes a memory, then 404s on a second delete', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const memory = await createMemory(baseUrl, workspaceId, userId, 'Delete candidate.');

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${memory.id}`, {
        method: 'DELETE',
        headers: authHeader(userId),
      });
      assert.equal(response.status, 200);

      const second = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories/${memory.id}`, {
        method: 'DELETE',
        headers: authHeader(userId),
      });
      assert.equal(second.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('PATCH/archive/DELETE reject a memory id belonging to another workspace with 404', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      const memory = await createMemory(baseUrl, a.workspaceId, a.userId, 'A only.');

      const patch = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(b.userId) },
        body: JSON.stringify({ content: 'hijack attempt' }),
      });
      assert.equal(patch.status, 404);

      const archive = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/memories/${memory.id}/archive`, {
        method: 'POST',
        headers: authHeader(b.userId),
      });
      assert.equal(archive.status, 404);

      const del = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/memories/${memory.id}`, {
        method: 'DELETE',
        headers: authHeader(b.userId),
      });
      assert.equal(del.status, 404);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});
