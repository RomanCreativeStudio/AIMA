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
  const email = `doc-route-test-${randomUUID()}@example.com`;
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

test('POST /api/workspaces/:id/documents imports a document and logs the action', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'markdown',
          content: '# Guide\n\nSome onboarding content here.',
          tags: ['guide'],
        }),
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as { document: { title: string; format: string }; permission: { kind: string } };
      assert.equal(body.document.title, 'Guide');
      assert.equal(body.document.format, 'markdown');
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

test('POST .../documents rejects an invalid format', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'docx', content: 'x' }),
      });
      assert.equal(response.status, 400);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('POST .../documents rejects an unknown workspaceId with 404', async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/00000000-0000-0000-0000-000000000000/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'plaintext', content: 'hello' }),
    });
    assert.equal(response.status, 404);
  });
});

test('GET .../documents lists imported documents scoped to the workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'Doc in workspace A.' }),
      });
      await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'Doc in workspace B.' }),
      });

      const response = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { documents: Array<{ workspaceId: string }> };
      assert.equal(body.documents.length, 1);
      assert.equal(body.documents[0].workspaceId, a.workspaceId);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('GET .../documents/search returns ranked chunks scoped to the workspace', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'markdown', content: '# Onboarding\n\nSchedule a kickoff call.' }),
      });
      await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'Kestrel backstory notes.' }),
      });

      const response = await fetch(
        `${baseUrl}/api/workspaces/${a.workspaceId}/documents/search?q=${encodeURIComponent('kickoff call onboarding')}`,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { results: Array<{ workspaceId: string }> };
      assert.ok(body.results.length > 0);
      assert.ok(body.results.every((r) => r.workspaceId === a.workspaceId));
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('GET .../documents/:id returns a single document; 404s across workspaces', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'Some content.' }),
      });
      const { document } = (await createResponse.json()) as { document: { id: string } };

      const ownResponse = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents/${document.id}`);
      assert.equal(ownResponse.status, 200);

      const crossResponse = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/documents/${document.id}`);
      assert.equal(crossResponse.status, 404);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});

test('POST .../documents/:id/reindex re-chunks with new content', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'Original content.', version: '1.0' }),
      });
      const { document } = (await createResponse.json()) as { document: { id: string } };

      const reindexResponse = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/documents/${document.id}/reindex`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Brand new content.', version: '2.0' }),
        },
      );

      assert.equal(reindexResponse.status, 200);
      const body = (await reindexResponse.json()) as { document: { version: string } };
      assert.equal(body.document.version, '2.0');
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('DELETE .../documents/:id removes the document', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const { userId, workspaceId } = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'To be deleted.' }),
      });
      const { document } = (await createResponse.json()) as { document: { id: string } };

      const deleteResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/documents/${document.id}`, {
        method: 'DELETE',
      });
      assert.equal(deleteResponse.status, 200);

      const getResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/documents/${document.id}`);
      assert.equal(getResponse.status, 404);
    } finally {
      await cleanupWorkspace(pool, userId);
    }
  });
});

test('DELETE .../documents/:id from a different workspace returns 404 and does not delete it', async () => {
  await withTestServer(async (baseUrl, pool) => {
    const a = await seedWorkspace(pool);
    const b = await seedWorkspace(pool);
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'plaintext', content: 'Protected content.' }),
      });
      const { document } = (await createResponse.json()) as { document: { id: string } };

      const deleteResponse = await fetch(`${baseUrl}/api/workspaces/${b.workspaceId}/documents/${document.id}`, {
        method: 'DELETE',
      });
      assert.equal(deleteResponse.status, 404);

      const getResponse = await fetch(`${baseUrl}/api/workspaces/${a.workspaceId}/documents/${document.id}`);
      assert.equal(getResponse.status, 200);
    } finally {
      await cleanupWorkspace(pool, a.userId);
      await cleanupWorkspace(pool, b.userId);
    }
  });
});
