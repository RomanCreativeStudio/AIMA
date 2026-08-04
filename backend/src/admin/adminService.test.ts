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
import { ExecutionService } from '../execution/executionService';
import { GmailSendEmailExecutor } from '../execution/executors/gmailSendEmailExecutor';
import { FeedbackService } from '../feedback/feedbackService';
import { StubCalendarConnector } from '../integrations/connectors/calendarConnector';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import { UsageMetricsService } from '../insights/usageMetricsService';
import { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PreferenceService } from '../preferences/preferenceService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { TaskService } from '../tasks/taskService';
import { UserService } from '../users/userService';
import type { UpdateUserProfileInput } from '../users/types';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowIntentMatcher } from '../workflows/workflowIntentMatcher';
import { WorkflowService } from '../workflows/workflowService';
import { WorkspaceService } from '../workspaces/workspaceService';
import { AdminService } from './adminService';

const TEST_CREDENTIAL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

function buildService(client: Client) {
  const registry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const documentService = new DocumentService(client, new MockEmbeddingProvider());
  const preferenceService = new PreferenceService(client);
  const workspaceService = new WorkspaceService(client);
  const userService = new UserService(client);
  const taskService = new TaskService(client);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const aiProvider = createAIProvider({ provider: 'mock' });
  const aimaCoreService = new AimaCoreService(contextManager, aiProvider, intentEngine, approvalEngine, workspaceService);
  const workflowIntentMatcher = new WorkflowIntentMatcher(new WorkflowRegistry());
  const executionRegistry = new ExecutionRegistry([new GmailSendEmailExecutor(new StubGmailConnector())]);
  const executionIntentMatcher = new ExecutionIntentMatcher(executionRegistry);
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
  const usageMetricsService = new UsageMetricsService(workspaceService, conversationService, memoryService, integrationService, sessionService);
  // Empty handler map is safe — AdminService only ever reads via WorkspaceInsightsService.getInsights (which
  // calls workflowService.listRuns, a plain DB read), never executeNextStep — same pattern briefingService.test.ts
  // already established.
  const workflowService = new WorkflowService(client, new WorkflowRegistry(), {} as Record<WorkflowKey, WorkflowHandler>, approvalEngine);
  const workspaceInsightsService = new WorkspaceInsightsService(workspaceService, actionLogger, workflowService, approvalEngine, taskService);
  const executionService = new ExecutionService(client, executionRegistry, integrationService, approvalEngine, permissionEngine);
  const feedbackService = new FeedbackService(client);

  const adminService = new AdminService(
    userService,
    workspaceService,
    feedbackService,
    usageMetricsService,
    workspaceInsightsService,
    executionService,
    sessionService,
  );

  return { adminService, userService, feedbackService };
}

async function markAsBetaTester(userService: UserService, userId: string): Promise<void> {
  const updates: UpdateUserProfileInput = { preferences: { betaTester: true } };
  await userService.updateProfile(userId, updates);
}

test('listBetaUsers only returns accounts with preferences.betaTester === true', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const betaTester = await seedWorkspace(client, 'personal');
    const regularUser = await seedWorkspace(client, 'rcs');
    await markAsBetaTester(userService, betaTester.userId);

    const results = await adminService.listBetaUsers();

    const ids = results.map((r) => r.userId);
    assert.ok(ids.includes(betaTester.userId));
    assert.ok(!ids.includes(regularUser.userId));
  });
});

test('listBetaUsers reports identity, workspace, signup date, and onboarding status', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'mfs');
    await userService.updateProfile(userId, {
      displayName: 'Roman',
      preferences: { betaTester: true, onboardingCompleted: true },
    });

    const results = await adminService.listBetaUsers();
    const summary = results.find((r) => r.userId === userId);

    assert.ok(summary, 'expected the newly-marked beta tester to appear in the results');
    assert.equal(summary?.displayName, 'Roman');
    assert.equal(summary?.workspaceId, workspaceId);
    assert.equal(summary?.onboardingCompleted, true);
    assert.ok(summary?.signupDate);
  });
});

test('listBetaUsers defaults onboardingCompleted to false when never set', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const { userId } = await seedWorkspace(client, 'development');
    await markAsBetaTester(userService, userId);

    const results = await adminService.listBetaUsers();
    const summary = results.find((r) => r.userId === userId);

    assert.equal(summary?.onboardingCompleted, false);
  });
});

test('listBetaUsers counts feedback submitted by that user', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService, feedbackService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    await markAsBetaTester(userService, userId);
    await feedbackService.createFeedback({ workspaceId, userId, type: 'bug', message: 'one' });
    await feedbackService.createFeedback({ workspaceId, userId, type: 'feature', message: 'two' });

    const results = await adminService.listBetaUsers();
    const summary = results.find((r) => r.userId === userId);

    assert.equal(summary?.feedbackCount, 2);
  });
});

test('listBetaUsers aggregates usage metrics for that user\'s workspace', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    await markAsBetaTester(userService, userId);
    const conversationId = await seedConversation(client, workspaceId);
    await client.query(`INSERT INTO messages (conversation_id, workspace_id, role, content) VALUES ($1, $2, 'user', 'hi')`, [
      conversationId,
      workspaceId,
    ]);
    await client.query(`INSERT INTO memory_records (workspace_id, content) VALUES ($1, 'remember this')`, [workspaceId]);

    const results = await adminService.listBetaUsers();
    const summary = results.find((r) => r.userId === userId);

    assert.equal(summary?.usage.conversationsCreated, 1);
    assert.equal(summary?.usage.messagesSent, 1);
    assert.equal(summary?.usage.memoriesCreated, 1);
  });
});

test('listBetaUsers isolates usage/feedback between two different beta testers', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService, feedbackService } = buildService(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    await markAsBetaTester(userService, a.userId);
    await markAsBetaTester(userService, b.userId);
    await feedbackService.createFeedback({ workspaceId: a.workspaceId, userId: a.userId, message: 'from a' });
    await seedConversation(client, b.workspaceId);

    const results = await adminService.listBetaUsers();
    const summaryA = results.find((r) => r.userId === a.userId);
    const summaryB = results.find((r) => r.userId === b.userId);

    assert.equal(summaryA?.feedbackCount, 1);
    assert.equal(summaryB?.feedbackCount, 0);
    assert.equal(summaryA?.usage.conversationsCreated, 0);
    assert.equal(summaryB?.usage.conversationsCreated, 1);
  });
});

test('listRecentFeedback returns submissions across every workspace, newest first, with submitter/workspace context', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, feedbackService } = buildService(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    await feedbackService.createFeedback({ workspaceId: a.workspaceId, userId: a.userId, type: 'bug', message: 'first' });
    await feedbackService.createFeedback({ workspaceId: b.workspaceId, userId: b.userId, type: 'feature', message: 'second' });

    const entries = await adminService.listRecentFeedback();

    assert.ok(entries.length >= 2);
    const secondEntry = entries.find((e) => e.message === 'second');
    assert.ok(secondEntry);
    assert.equal(secondEntry?.workspaceId, b.workspaceId);
    assert.ok(secondEntry?.userEmail);
    assert.ok(secondEntry?.workspaceName);
    assert.equal(secondEntry?.status, 'new');
  });
});

test('updateFeedbackStatus advances the status and re-enriches with submitter/workspace context', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, feedbackService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    const feedback = await feedbackService.createFeedback({ workspaceId, userId, message: 'needs review' });

    const updated = await adminService.updateFeedbackStatus(feedback.id, 'reviewed');

    assert.equal(updated.status, 'reviewed');
    assert.ok(updated.userEmail);
    assert.ok(updated.workspaceName);
  });
});

test('updateFeedbackStatus rejects an invalid transition', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, feedbackService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const feedback = await feedbackService.createFeedback({ workspaceId, userId, message: 'x' });

    await assert.rejects(() => adminService.updateFeedbackStatus(feedback.id, 'resolved'));
  });
});

test('listRecentFeedback respects the limit parameter', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, feedbackService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    await feedbackService.createFeedback({ workspaceId, userId, message: 'one' });
    await feedbackService.createFeedback({ workspaceId, userId, message: 'two' });
    await feedbackService.createFeedback({ workspaceId, userId, message: 'three' });

    const entries = await adminService.listRecentFeedback(1);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'three');
  });
});
