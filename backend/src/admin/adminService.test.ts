import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { MockEmbeddingProvider, RuleBasedIntentClassifier, createAIProvider } from '@aima/ai-engine';
import { seedCapabilities, seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
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
import { UserNotFoundError } from '../users/errors';
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

  return {
    adminService,
    userService,
    feedbackService,
    workspaceService,
    sessionService,
    approvalEngine,
    executionService,
    integrationService,
  };
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

test('listBetaUsers filters by a query matching email or displayName', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    await markAsBetaTester(userService, a.userId);
    await markAsBetaTester(userService, b.userId);
    await userService.updateProfile(a.userId, { displayName: 'Roman Findlay' });

    const results = await adminService.listBetaUsers('roman');

    assert.equal(results.length, 1);
    assert.equal(results[0].userId, a.userId);
  });
});

test('listAllUsers returns every account, including ones not marked as beta testers', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const betaTester = await seedWorkspace(client, 'personal');
    const regularUser = await seedWorkspace(client, 'rcs');
    await markAsBetaTester(userService, betaTester.userId);

    const results = await adminService.listAllUsers();
    const ids = results.map((r) => r.userId);

    assert.ok(ids.includes(betaTester.userId));
    assert.ok(ids.includes(regularUser.userId));
    assert.equal(results.find((r) => r.userId === betaTester.userId)?.betaTester, true);
    assert.equal(results.find((r) => r.userId === regularUser.userId)?.betaTester, false);
  });
});

test('listAllUsers filters by a query matching email or displayName', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const a = await seedWorkspace(client, 'rcs');
    await seedWorkspace(client, 'mfs');
    await userService.updateProfile(a.userId, { displayName: 'Unique Candidate' });

    const results = await adminService.listAllUsers('unique candidate');

    assert.equal(results.length, 1);
    assert.equal(results[0].userId, a.userId);
  });
});

test('updateUserBetaStatus toggles betaTester without touching unrelated preferences', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const { userId } = await seedWorkspace(client, 'personal');
    await userService.updateProfile(userId, { preferences: { onboardingCompleted: true } });

    const updated = await adminService.updateUserBetaStatus(userId, { betaTester: true });

    assert.equal(updated.betaTester, true);
    const reloaded = await userService.getUser(userId);
    assert.equal(reloaded.preferences.onboardingCompleted, true);
    assert.equal(reloaded.preferences.betaTester, true);
  });
});

test('updateUserBetaStatus records adminNotes and adminTags without touching betaTester', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const { userId } = await seedWorkspace(client, 'rcs');
    await markAsBetaTester(userService, userId);

    const updated = await adminService.updateUserBetaStatus(userId, {
      adminNotes: 'Invited via Discord, follow up 3/1',
      adminTags: ['design-partner', 'power-user'],
    });

    assert.equal(updated.betaTester, true);
    assert.equal(updated.adminNotes, 'Invited via Discord, follow up 3/1');
    assert.deepEqual(updated.adminTags, ['design-partner', 'power-user']);
  });
});

test('updateUserBetaStatus rejects an unknown userId with UserNotFoundError', async () => {
  await withTestTransaction(async (client) => {
    const { adminService } = buildService(client);

    await assert.rejects(
      () => adminService.updateUserBetaStatus('00000000-0000-0000-0000-000000000000', { betaTester: true }),
      UserNotFoundError,
    );
  });
});

test('listBetaUsers surfaces adminNotes/adminTags recorded via updateUserBetaStatus', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const { userId } = await seedWorkspace(client, 'mfs');
    await markAsBetaTester(userService, userId);
    await adminService.updateUserBetaStatus(userId, { adminNotes: 'VIP', adminTags: ['vip'] });

    const results = await adminService.listBetaUsers();
    const summary = results.find((r) => r.userId === userId);

    assert.equal(summary?.adminNotes, 'VIP');
    assert.deepEqual(summary?.adminTags, ['vip']);
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

test('getPlatformAnalytics returns a well-formed shape with non-negative totals', async () => {
  await withTestTransaction(async (client) => {
    const { adminService } = buildService(client);

    const analytics = await adminService.getPlatformAnalytics();

    for (const value of Object.values(analytics)) {
      if (typeof value === 'number') assert.ok(value >= 0, `expected non-negative, got ${value}`);
    }
    assert.ok(analytics.generatedAt);
  });
});

// The test database may carry committed rows left over from other test files (route tests use a real Pool,
// not a rolled-back transaction), and — because these read global, unscoped tables (every user, every
// workspace) rather than one seeded workspaceId — even a rolled-back transaction can observe concurrent
// commits *and deletes* from those other files mid-run (plain READ COMMITTED, not a snapshot isolation
// level), so a "before vs. after" delta can drift in either direction from unrelated activity alone. These
// assert absolute lower bounds on rows this test itself creates instead — safe because nothing outside this
// test knows this test's randomly-generated ids, so nothing else can delete them mid-test.
test('getPlatformAnalytics counts total and beta users', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, userService } = buildService(client);
    const a = await seedWorkspace(client, 'rcs');
    await seedWorkspace(client, 'mfs');
    await markAsBetaTester(userService, a.userId);

    const analytics = await adminService.getPlatformAnalytics();

    assert.ok(analytics.totalUsers >= 2);
    assert.ok(analytics.betaUsers >= 1);
    assert.ok(analytics.totalWorkspaces >= 2);
  });
});

test('getPlatformAnalytics counts a user as active within 24h and 7d, but not once older than 7d', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, sessionService } = buildService(client);
    const recent = await seedWorkspace(client, 'rcs');
    const stale = await seedWorkspace(client, 'mfs');
    await sessionService.createSession(recent.userId, 'refresh-recent');
    await sessionService.createSession(stale.userId, 'refresh-stale');
    await client.query(`UPDATE auth_sessions SET last_seen_at = now() - interval '10 days' WHERE user_id = $1`, [
      stale.userId,
    ]);

    const analytics = await adminService.getPlatformAnalytics();

    assert.ok(analytics.activeUsers24h >= 1);
    assert.ok(analytics.activeUsers7d >= 1);
  });
});

test('getPlatformAnalytics sums conversations, messages, and memories across every workspace', async () => {
  await withTestTransaction(async (client) => {
    const { adminService } = buildService(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    await seedConversation(client, a.workspaceId);
    await seedConversation(client, b.workspaceId);
    await client.query(`INSERT INTO memory_records (workspace_id, content) VALUES ($1, 'remember this')`, [
      a.workspaceId,
    ]);

    const analytics = await adminService.getPlatformAnalytics();

    assert.ok(analytics.totalConversations >= 2);
    assert.ok(analytics.totalMemories >= 1);
  });
});

test('getPlatformAnalytics breaks feedback down by status', async () => {
  await withTestTransaction(async (client) => {
    const { adminService, feedbackService } = buildService(client);
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    const f1 = await feedbackService.createFeedback({ workspaceId, userId, message: 'one' });
    await feedbackService.createFeedback({ workspaceId, userId, message: 'two' });
    await feedbackService.updateStatus(f1.id, 'reviewed');

    const analytics = await adminService.getPlatformAnalytics();

    assert.ok(analytics.totalFeedback >= 2);
    assert.ok(analytics.pendingFeedback >= 1);
    assert.ok(analytics.reviewedFeedback >= 1);
  });
});

test('getPlatformAnalytics counts approvals created/completed and executions completed', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { adminService, approvalEngine, executionService, integrationService } = buildService(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    await integrationService.connect({
      workspaceId,
      provider: 'gmail',
      credentials: { accessToken: 'a', refreshToken: 'b' },
    });

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });
    await approvalEngine.approve(workspaceId, execution.pendingApprovalId!);
    await executionService.execute(workspaceId, execution.id);

    const analytics = await adminService.getPlatformAnalytics();

    assert.ok(analytics.approvalsCreated >= 1);
    assert.ok(analytics.approvalsCompleted >= 1);
    assert.ok(analytics.executionsCompleted >= 1);
  });
});
