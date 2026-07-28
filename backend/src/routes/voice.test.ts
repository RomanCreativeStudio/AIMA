import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import type { SpeechToTextProvider, TextToSpeechProvider } from '@aima/ai-engine';
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

async function withTestServer(
  fn: (baseUrl: string, pool: Pool) => Promise<void>,
  voiceProviders: { speechToText?: SpeechToTextProvider; textToSpeech?: TextToSpeechProvider } = {},
): Promise<void> {
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
  const voiceService = new VoiceService(
    pool,
    conversationService,
    voiceProviders.speechToText ?? new MockSpeechToTextProvider(),
    voiceProviders.textToSpeech ?? new MockTextToSpeechProvider(),
  );

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
  const email = `voice-route-test-${randomUUID()}@example.com`;
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

test('POST /api/workspaces/:id/voice/sessions starts an active session', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { session: { status: string; workspaceId: string } };
      assert.equal(body.session.status, 'active');
      assert.equal(body.session.workspaceId, workspaceId);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../voice/sessions rejects an unknown workspaceId with 404, not 500', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/voice/sessions`, {
      method: 'POST',
    });
    assert.equal(response.status, 404);
  });
});

test('POST .../voice/sessions/:id/end ends an active session', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const start = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      const { session } = (await start.json()) as { session: { id: string } };

      const end = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/end`, {
        method: 'POST',
      });
      assert.equal(end.status, 200);
      const body = (await end.json()) as { session: { status: string } };
      assert.equal(body.session.status, 'ended');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../voice/sessions/:id/end twice returns 409 the second time', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const start = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      const { session } = (await start.json()) as { session: { id: string } };

      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/end`, { method: 'POST' });
      const second = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/end`, {
        method: 'POST',
      });
      assert.equal(second.status, 409);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../voice/sessions lists sessions for the workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { sessions: unknown[] };
      assert.equal(body.sessions.length, 2);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../voice/sessions/:id/turns transcribes, replies, and synthesizes audio', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const start = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      const { session } = (await start.json()) as { session: { id: string } };

      const audioBase64 = Buffer.from('What meetings do I have today?', 'utf-8').toString('base64');
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, audioMimeType: 'audio/wav' }),
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as {
        turn: { transcript: { text: string } };
        audioBase64: string;
        audioMimeType: string;
      };
      assert.equal(body.turn.transcript.text, 'What meetings do I have today?');
      assert.equal(body.audioMimeType, 'text/plain');
      assert.ok(body.audioBase64.length > 0);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../voice/sessions/:id/turns rejects a missing audioBase64 with 400', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const start = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      const { session } = (await start.json()) as { session: { id: string } };

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioMimeType: 'audio/wav' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('GET .../voice/sessions/:id/turns lists submitted turns oldest-first', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const start = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
      const { session } = (await start.json()) as { session: { id: string } };

      const submit = (text: string) =>
        fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/turns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: Buffer.from(text, 'utf-8').toString('base64'), audioMimeType: 'audio/wav' }),
        });
      await submit('first');
      await submit('second');

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/turns`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { turns: Array<{ transcript: { text: string } }> };
      assert.equal(body.turns.length, 2);
      assert.equal(body.turns[0].transcript.text, 'first');
      assert.equal(body.turns[1].transcript.text, 'second');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../voice/sessions/:id/turns returns 502 with a safe message when the STT provider fails', async () => {
  const failingSpeechToText: SpeechToTextProvider = {
    name: 'failing',
    transcribe: async () => {
      throw new Error('vendor said: invalid api key sk-live-abc123');
    },
  };

  await withTestServer(
    async (baseUrl, pool) => {
      const { userId, workspaceId } = await seedWorkspace(pool);
      try {
        const start = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions`, { method: 'POST' });
        const { session } = (await start.json()) as { session: { id: string } };

        const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/voice/sessions/${session.id}/turns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: Buffer.from('hi', 'utf-8').toString('base64'), audioMimeType: 'audio/wav' }),
        });

        assert.equal(response.status, 502);
        const body = (await response.json()) as { error: string };
        assert.doesNotMatch(body.error, /sk-live-abc123/, 'the vendor error body must never reach the client');
      } finally {
        await cleanupWorkspace(pool, userId);
      }
    },
    { speechToText: failingSpeechToText },
  );
});

test('voice session routes 404 across workspace isolation', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId: userA, workspaceId: workspaceA } = await seedWorkspace(pool);
    const { userId: userB, workspaceId: workspaceB } = await seedWorkspace(pool);
    try {
      const start = await fetch(`${baseUrl}/api/workspaces/${workspaceA}/voice/sessions`, { method: 'POST' });
      const { session } = (await start.json()) as { session: { id: string } };

      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceB}/voice/sessions/${session.id}`);
      assert.equal(response.status, 404);
    } finally {
      await cleanupWorkspace(pool, userA);
      await cleanupWorkspace(pool, userB);
    }
  });
});
