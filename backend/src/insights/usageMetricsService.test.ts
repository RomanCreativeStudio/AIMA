import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { MockEmbeddingProvider, RuleBasedIntentClassifier, createAIProvider } from '@aima/ai-engine';
import { seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { MockAuthProvider } from '../auth/mockAuthProvider';
import { SessionService } from '../auth/sessionService';
import { AimaCoreService } from '../core/aimaCoreService';
import { ContextManager } from '../core/contextManager';
import { ConversationService } from '../conversation/conversationService';
import { ExecutionIntentMatcher } from '../execution/executionIntentMatcher';
import { ExecutionRegistry } from '../execution/registry';
import { GmailSendEmailExecutor } from '../execution/executors/gmailSendEmailExecutor';
import { StubCalendarConnector } from '../integrations/connectors/calendarConnector';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PreferenceService } from '../preferences/preferenceService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { WorkflowIntentMatcher } from '../workflows/workflowIntentMatcher';
import { WorkflowRegistry } from '../workflows/registry';
import { WorkspaceService } from '../workspaces/workspaceService';
import { UsageMetricsService } from './usageMetricsService';

const TEST_CREDENTIAL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

function buildService(client: Client): UsageMetricsService {
  const registry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const documentService = new DocumentService(client, new MockEmbeddingProvider());
  const preferenceService = new PreferenceService(client);
  const workspaceService = new WorkspaceService(client);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const aiProvider = createAIProvider({ provider: 'mock' });
  const aimaCoreService = new AimaCoreService(contextManager, aiProvider, intentEngine, approvalEngine, workspaceService);
  const workflowIntentMatcher = new WorkflowIntentMatcher(new WorkflowRegistry());
  const executionIntentMatcher = new ExecutionIntentMatcher(
    new ExecutionRegistry([new GmailSendEmailExecutor(new StubGmailConnector())]),
  );
  const conversationService = new ConversationService({
    db: client,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
    executionIntentMatcher,
  });
  const integrationRegistry = new IntegrationRegistry();
  const integrationService = new IntegrationService(
    client,
    integrationRegistry,
    { gmail: new StubGmailConnector(), github: new StubGitHubConnector(), calendar: new StubCalendarConnector() },
    new AesGcmCredentialEncryptor(TEST_CREDENTIAL_ENCRYPTION_KEY),
  );
  const sessionService = new SessionService(client, new MockAuthProvider());

  return new UsageMetricsService(workspaceService, conversationService, memoryService, integrationService, sessionService);
}

test('getUsageMetrics counts conversations, messages, and memories created in the workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const conversationId = await seedConversation(client, workspaceId);
    await client.query(`INSERT INTO messages (conversation_id, workspace_id, role, content) VALUES ($1, $2, 'user', 'hi')`, [
      conversationId,
      workspaceId,
    ]);
    await client.query(`INSERT INTO messages (conversation_id, workspace_id, role, content) VALUES ($1, $2, 'assistant', 'hello')`, [
      conversationId,
      workspaceId,
    ]);
    await client.query(`INSERT INTO memory_records (workspace_id, content) VALUES ($1, 'remember this')`, [workspaceId]);

    const service = buildService(client);
    const usage = await service.getUsageMetrics(workspaceId);

    assert.equal(usage.workspaceId, workspaceId);
    assert.equal(usage.conversationsCreated, 1);
    assert.equal(usage.messagesSent, 1, 'only the user-authored message counts as "sent"');
    assert.equal(usage.memoriesCreated, 1);
  });
});

test('getUsageMetrics excludes archived memories from the count', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    await client.query(`INSERT INTO memory_records (workspace_id, content, archived_at) VALUES ($1, 'stale', now())`, [
      workspaceId,
    ]);

    const service = buildService(client);
    const usage = await service.getUsageMetrics(workspaceId);

    assert.equal(usage.memoriesCreated, 0);
  });
});

test('getUsageMetrics counts only connected integrations', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'mfs');
    await client.query(
      `INSERT INTO workspace_integrations (workspace_id, provider, enabled, status) VALUES ($1, 'gmail', true, 'connected')`,
      [workspaceId],
    );
    await client.query(
      `INSERT INTO workspace_integrations (workspace_id, provider, enabled, status) VALUES ($1, 'github', false, 'disconnected')`,
      [workspaceId],
    );

    const service = buildService(client);
    const usage = await service.getUsageMetrics(workspaceId);

    assert.equal(usage.integrationsConnected, 1);
  });
});

test('getUsageMetrics reports the owning user\'s most recent session as lastActiveAt', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'development');
    const sessionService = new SessionService(client, new MockAuthProvider());
    await sessionService.createSession(userId, 'refresh-token-1');

    const service = buildService(client);
    const usage = await service.getUsageMetrics(workspaceId);

    assert.ok(usage.lastActiveAt);
  });
});

test('getUsageMetrics reports lastActiveAt as null for an account with no recorded session', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');

    const service = buildService(client);
    const usage = await service.getUsageMetrics(workspaceId);

    assert.equal(usage.lastActiveAt, null);
  });
});

test('getUsageMetrics isolates workspaces from each other', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    await seedConversation(client, a.workspaceId);

    const service = buildService(client);
    const usageA = await service.getUsageMetrics(a.workspaceId);
    const usageB = await service.getUsageMetrics(b.workspaceId);

    assert.equal(usageA.conversationsCreated, 1);
    assert.equal(usageB.conversationsCreated, 0);
  });
});
