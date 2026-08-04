import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import { StubCalendarConnector } from '../integrations/connectors/calendarConnector';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import type { IntegrationConnector } from '../integrations/connectors/types';
import type { IntegrationProvider } from '../integrations/types';
import { MemoryService } from '../memory/memoryService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { PatternDetectionService } from '../proactive/patternDetectionService';
import { ProactiveIntelligenceService } from '../proactive/proactiveIntelligenceService';
import { TaskService } from '../tasks/taskService';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowService } from '../workflows/workflowService';
import { WorkspaceService } from '../workspaces/workspaceService';
import {
  BriefingService,
  buildGreeting,
  isBlockedTask,
  isOpenCommitment,
  isPostponedTask,
  isRecentDecision,
  isUnresolvedFollowUp,
  needsAttention,
} from './briefingService';

const TEST_CREDENTIAL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

/** `executeNextStep` is never called in these tests, so an empty handler map is safe — `createRun`/`listRuns` don't touch it. */
function buildService(client: Client) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const taskService = new TaskService(client);
  const workspaceService = new WorkspaceService(client);
  const actionLogger = new ActionLogger(client);
  const workflowRegistry = new WorkflowRegistry();
  const workflowService = new WorkflowService(client, workflowRegistry, {} as Record<WorkflowKey, WorkflowHandler>, approvalEngine);
  const briefingService = new BriefingService(workspaceService, taskService, approvalEngine, workflowService, actionLogger);

  return { briefingService, taskService, approvalEngine, workflowService, actionLogger, permissionEngine, workspaceService };
}

/** The full, Phase 3.5 constructor — also wires `MemoryService`/`ProactiveIntelligenceService` so `recentMemories`/`calendarHighlights`/`suggestedNextActions` are actually populated. */
function buildFullService(client: Client) {
  const base = buildService(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const integrationRegistry = new IntegrationRegistry();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: new StubGmailConnector(),
    github: new StubGitHubConnector(),
    calendar: new StubCalendarConnector(),
  };
  const integrationService = new IntegrationService(
    client,
    integrationRegistry,
    connectors,
    new AesGcmCredentialEncryptor(TEST_CREDENTIAL_ENCRYPTION_KEY),
  );
  const patternDetectionService = new PatternDetectionService(
    base.workspaceService,
    base.taskService,
    base.workflowService,
    base.approvalEngine,
    base.actionLogger,
    memoryService,
  );
  const proactiveIntelligenceService = new ProactiveIntelligenceService(
    patternDetectionService,
    memoryService,
    integrationService,
    integrationRegistry,
  );
  const briefingService = new BriefingService(
    base.workspaceService,
    base.taskService,
    base.approvalEngine,
    base.workflowService,
    base.actionLogger,
    memoryService,
    proactiveIntelligenceService,
    integrationService,
  );

  return { ...base, briefingService, memoryService, proactiveIntelligenceService, integrationService };
}

async function capabilityIdFor(client: Client, actionType: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id FROM capabilities WHERE action_type = $1', [actionType]);
  return result.rows[0].id;
}

test('getDailyBriefing rejects an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    const { briefingService } = buildService(client);
    await assert.rejects(
      briefingService.getDailyBriefing('00000000-0000-0000-0000-000000000000'),
      WorkspaceNotFoundError,
    );
  });
});

test('getDailyBriefing reports zeros and empty lists for a brand-new workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService } = buildService(client);

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.workspaceId, workspaceId);
    assert.equal(briefing.workspaceName, 'rcs');
    assert.equal(briefing.pendingApprovalCount, 0);
    assert.deepEqual(briefing.pendingApprovals, []);
    assert.equal(briefing.activeWorkflowCount, 0);
    assert.deepEqual(briefing.activeWorkflows, []);
    assert.deepEqual(briefing.priorityTasks, []);
    assert.deepEqual(briefing.recentActivity, []);
    assert.deepEqual(briefing.recentMemories, [], 'recentMemories defaults to [] when memoryService is omitted');
    assert.deepEqual(briefing.openCommitments, [], 'openCommitments defaults to [] when memoryService is omitted');
    assert.deepEqual(briefing.acceptedTasks, []);
    assert.deepEqual(briefing.unresolvedFollowUps, []);
    assert.deepEqual(briefing.recentDecisions, [], 'recentDecisions defaults to [] when memoryService is omitted');
    assert.deepEqual(briefing.completedYesterday, []);
    assert.deepEqual(briefing.blockedItems, []);
    assert.deepEqual(briefing.postponedItems, []);
    assert.deepEqual(briefing.calendarHighlights, []);
    assert.deepEqual(
      briefing.suggestedNextActions,
      [],
      'suggestedNextActions defaults to [] when proactiveIntelligenceService is omitted',
    );
    assert.ok(briefing.generatedAt);
  });
});

test('getDailyBriefing surfaces pending approvals, active workflow runs, priority tasks, and recent activity, all workspace-scoped', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, taskService, approvalEngine, workflowService, actionLogger, permissionEngine } =
      buildService(client);

    await taskService.createTask({ workspaceId, title: 'Ship the release', priority: 'high' });
    await taskService.createTask({ workspaceId: otherWorkspaceId, title: 'Other workspace task', priority: 'high' });

    await approvalEngine.evaluate(workspaceId, 'send_email', { to: 'client@example.com' });
    await approvalEngine.evaluate(otherWorkspaceId, 'send_email', { to: 'other@example.com' });

    await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.createRun({ workspaceId: otherWorkspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    await actionLogger.log({
      workspaceId,
      tier: permissionEngine.resolveTier('create_task'),
      summary: 'Created a task',
      outcome: 'success',
    });
    await actionLogger.log({
      workspaceId: otherWorkspaceId,
      tier: permissionEngine.resolveTier('create_task'),
      summary: 'Other workspace action',
      outcome: 'success',
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.pendingApprovalCount, 1);
    assert.equal(briefing.pendingApprovals[0].actionType, 'send_email');
    assert.equal(briefing.activeWorkflowCount, 1);
    assert.equal(briefing.activeWorkflows[0].workflowKey, 'daily_workspace_briefing');
    assert.equal(briefing.priorityTasks.length, 1);
    assert.equal(briefing.priorityTasks[0].title, 'Ship the release');
    assert.equal(briefing.recentActivity.length, 1);
    assert.equal(briefing.recentActivity[0].summary, 'Created a task');
  });
});

test('getDailyBriefing excludes done/cancelled tasks and terminal workflow runs', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, taskService, workflowService } = buildService(client);

    const done = await taskService.createTask({ workspaceId, title: 'Already shipped' });
    await taskService.updateTask(workspaceId, done.id, { status: 'done' });

    const run = await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.cancel(workspaceId, run.id);

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.deepEqual(briefing.priorityTasks, []);
    assert.deepEqual(briefing.activeWorkflows, []);
    assert.equal(briefing.activeWorkflowCount, 0);
  });
});

test('getDailyBriefing surfaces recentMemories, scoped to the workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, memoryService } = buildFullService(client);

    await memoryService.createMemory({ workspaceId, scope: 'workspace', content: 'First memory.' });
    await memoryService.createMemory({ workspaceId, scope: 'workspace', content: 'Second memory.' });
    await memoryService.createMemory({ workspaceId: otherWorkspaceId, scope: 'workspace', content: 'Other workspace memory.' });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.recentMemories.length, 2);
    assert.ok(briefing.recentMemories.every((memory) => memory.workspaceId === workspaceId));
  });
});

// Personal Workspace Memory sprint: openCommitments, derived from the same listMemories call as recentMemories.

test('getDailyBriefing surfaces openCommitments from auto-extracted reminder/decision/project_update memories, excluding completed_task', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, memoryService } = buildFullService(client);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Remind me to send the invoice.',
      source: 'auto_extracted',
      metadata: { category: 'reminder' },
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "We've decided to ship on Friday.",
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "I've finished the onboarding redesign.",
      source: 'auto_extracted',
      metadata: { category: 'completed_task' },
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'A manually saved fact, not an open commitment.',
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.openCommitments.length, 2);
    assert.ok(briefing.openCommitments.every((m) => m.metadata.category !== 'completed_task'));
    assert.ok(briefing.openCommitments.some((m) => m.metadata.category === 'reminder'));
    assert.ok(briefing.openCommitments.some((m) => m.metadata.category === 'decision'));
  });
});

test('getDailyBriefing openCommitments is workspace-scoped', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, memoryService } = buildFullService(client);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Remind me to send the invoice.',
      source: 'auto_extracted',
      metadata: { category: 'reminder' },
    });
    await memoryService.createMemory({
      workspaceId: otherWorkspaceId,
      scope: 'workspace',
      content: 'Remind me about the other workspace.',
      source: 'auto_extracted',
      metadata: { category: 'reminder' },
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.openCommitments.length, 1);
    assert.equal(briefing.openCommitments[0].workspaceId, workspaceId);
  });
});

test('isOpenCommitment requires source auto_extracted and an open-commitment category', () => {
  const base = {
    id: 'm1',
    workspaceId: 'w1',
    scope: 'workspace' as const,
    content: 'x',
    conversationId: null,
    projectKey: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    importanceScore: 0.5,
    confidenceScore: 0.5,
    memoryType: 'long_term' as const,
    lastAccessedAt: null,
    expiresAt: null,
    archivedAt: null,
  };

  assert.equal(isOpenCommitment({ ...base, source: 'auto_extracted', metadata: { category: 'reminder' } }), true);
  assert.equal(isOpenCommitment({ ...base, source: 'auto_extracted', metadata: { category: 'decision' } }), true);
  assert.equal(isOpenCommitment({ ...base, source: 'auto_extracted', metadata: { category: 'project_update' } }), true);
  assert.equal(isOpenCommitment({ ...base, source: 'auto_extracted', metadata: { category: 'completed_task' } }), false);
  assert.equal(isOpenCommitment({ ...base, source: null, metadata: { category: 'reminder' } }), false);
  assert.equal(isOpenCommitment({ ...base, source: 'auto_extracted', metadata: {} }), false);
});

// Conversation → Action sprint: acceptedTasks, unresolvedFollowUps, recentDecisions.

test('getDailyBriefing surfaces acceptedTasks (source: conversation_suggestion), excluding hand-created tasks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, taskService } = buildService(client);

    await taskService.createTask({
      workspaceId,
      title: 'Follow up on the Acme contract',
      source: 'conversation_suggestion',
      metadata: { category: 'follow_up' },
    });
    await taskService.createTask({ workspaceId, title: 'A hand-typed task' });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.acceptedTasks.length, 1);
    assert.equal(briefing.acceptedTasks[0].title, 'Follow up on the Acme contract');
  });
});

test('getDailyBriefing acceptedTasks/unresolvedFollowUps is workspace-scoped', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, taskService } = buildService(client);

    await taskService.createTask({
      workspaceId,
      title: 'Follow up on the Acme contract',
      source: 'conversation_suggestion',
      metadata: { category: 'follow_up' },
    });
    await taskService.createTask({
      workspaceId: otherWorkspaceId,
      title: 'Follow up on the other workspace',
      source: 'conversation_suggestion',
      metadata: { category: 'follow_up' },
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.acceptedTasks.length, 1);
    assert.equal(briefing.unresolvedFollowUps.length, 1);
    assert.equal(briefing.acceptedTasks[0].workspaceId, workspaceId);
  });
});

test('getDailyBriefing unresolvedFollowUps excludes follow_up tasks already done, and non-follow_up categories', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, taskService } = buildService(client);

    const openFollowUp = await taskService.createTask({
      workspaceId,
      title: 'Open follow-up',
      source: 'conversation_suggestion',
      metadata: { category: 'follow_up' },
    });
    const doneFollowUp = await taskService.createTask({
      workspaceId,
      title: 'Done follow-up',
      source: 'conversation_suggestion',
      metadata: { category: 'follow_up' },
    });
    await taskService.updateTask(workspaceId, doneFollowUp.id, { status: 'done' });
    await taskService.createTask({
      workspaceId,
      title: 'Open todo, not a follow-up',
      source: 'conversation_suggestion',
      metadata: { category: 'todo' },
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.acceptedTasks.length, 3);
    assert.equal(briefing.unresolvedFollowUps.length, 1);
    assert.equal(briefing.unresolvedFollowUps[0].id, openFollowUp.id);
  });
});

test('getDailyBriefing surfaces recentDecisions from auto-extracted decision memories, workspace-scoped', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, memoryService } = buildFullService(client);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "We've decided to ship on Friday.",
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Remind me to send the invoice.',
      source: 'auto_extracted',
      metadata: { category: 'reminder' },
    });
    await memoryService.createMemory({
      workspaceId: otherWorkspaceId,
      scope: 'workspace',
      content: 'A decision in the other workspace.',
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.recentDecisions.length, 1);
    assert.equal(briefing.recentDecisions[0].content, "We've decided to ship on Friday.");
    assert.equal(briefing.recentDecisions[0].workspaceId, workspaceId);
  });
});

test('isUnresolvedFollowUp requires an open task with metadata.category === follow_up', () => {
  const base = {
    id: 't1',
    workspaceId: 'w1',
    title: 'x',
    description: null,
    priority: 'medium' as const,
    dueDate: null,
    source: 'conversation_suggestion',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(isUnresolvedFollowUp({ ...base, status: 'todo', metadata: { category: 'follow_up' } }), true);
  assert.equal(isUnresolvedFollowUp({ ...base, status: 'done', metadata: { category: 'follow_up' } }), false);
  assert.equal(isUnresolvedFollowUp({ ...base, status: 'todo', metadata: { category: 'todo' } }), false);
  assert.equal(isUnresolvedFollowUp({ ...base, status: 'todo', metadata: {} }), false);
});

test('isRecentDecision requires source auto_extracted and category decision', () => {
  const base = {
    id: 'm1',
    workspaceId: 'w1',
    scope: 'workspace' as const,
    content: 'x',
    conversationId: null,
    projectKey: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    importanceScore: 0.5,
    confidenceScore: 0.5,
    memoryType: 'long_term' as const,
    lastAccessedAt: null,
    expiresAt: null,
    archivedAt: null,
  };

  assert.equal(isRecentDecision({ ...base, source: 'auto_extracted', metadata: { category: 'decision' } }), true);
  assert.equal(isRecentDecision({ ...base, source: 'auto_extracted', metadata: { category: 'reminder' } }), false);
  assert.equal(isRecentDecision({ ...base, source: null, metadata: { category: 'decision' } }), false);
});

test('getDailyBriefing surfaces calendarHighlights only for calendar write action types, from recentActivity', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, actionLogger, permissionEngine } = buildFullService(client);

    const calendarCapabilityId = await capabilityIdFor(client, 'create_calendar_event');
    const taskCapabilityId = await capabilityIdFor(client, 'create_task');

    await actionLogger.log({
      workspaceId,
      capabilityId: calendarCapabilityId,
      tier: permissionEngine.resolveTier('create_calendar_event'),
      summary: 'Created a calendar event',
      outcome: 'success',
    });
    await actionLogger.log({
      workspaceId,
      capabilityId: taskCapabilityId,
      tier: permissionEngine.resolveTier('create_task'),
      summary: 'Created a task',
      outcome: 'success',
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.calendarHighlights.length, 1);
    assert.equal(briefing.calendarHighlights[0].actionType, 'create_calendar_event');
  });
});

test('getDailyBriefing surfaces suggestedNextActions from the Proactive Intelligence Engine, capped at 3', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, workflowService } = buildFullService(client);

    for (let i = 0; i < 3; i += 1) {
      await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    }

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.ok(briefing.suggestedNextActions.length > 0);
    assert.ok(briefing.suggestedNextActions.length <= 3);
    assert.ok(briefing.suggestedNextActions.some((s) => s.source === 'frequent_workflow_pattern'));
  });
});

// Alpha Daily Briefing sprint: greeting, overdueTasks, integrationsNeedingAttention.

test('getDailyBriefing includes a non-empty greeting mentioning the workspace name', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService } = buildService(client);

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.ok(briefing.greeting.length > 0);
    assert.ok(briefing.greeting.includes('rcs'));
  });
});

test('getDailyBriefing surfaces overdueTasks, workspace-scoped, using the same overdue rule as TaskIntelligenceService', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, taskService } = buildService(client);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const overdue = await taskService.createTask({ workspaceId, title: 'Overdue task', dueDate: yesterday });
    await taskService.createTask({ workspaceId, title: 'Not due yet', dueDate: tomorrow });
    await taskService.createTask({ workspaceId, title: 'No due date' });
    await taskService.createTask({ workspaceId: otherWorkspaceId, title: 'Other workspace overdue', dueDate: yesterday });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.overdueTasks.length, 1);
    assert.equal(briefing.overdueTasks[0].id, overdue.id);
  });
});

test('getDailyBriefing overdueTasks defaults to empty and never throws for a brand-new workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService } = buildService(client);

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.deepEqual(briefing.overdueTasks, []);
  });
});

test('getDailyBriefing integrationsNeedingAttention defaults to empty when integrationService is omitted', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService } = buildService(client);

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.deepEqual(briefing.integrationsNeedingAttention, []);
  });
});

test('getDailyBriefing surfaces a connected integration whose token has already expired', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, integrationService } = buildFullService(client);

    await integrationService.connect({
      workspaceId,
      provider: 'github',
      credentials: { accessToken: 'gh-token', expiresAt: new Date(Date.now() - 60_000).toISOString() },
    });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.integrationsNeedingAttention.length, 1);
    assert.equal(briefing.integrationsNeedingAttention[0].provider, 'github');
  });
});

test('getDailyBriefing does not flag a connected integration with no expiry or a future one', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, integrationService } = buildFullService(client);

    await integrationService.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'gh-token' } });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.deepEqual(briefing.integrationsNeedingAttention, []);
  });
});

// Executive Assistant Loop sprint: completedYesterday, blockedItems, postponedItems.

test('getDailyBriefing surfaces completedYesterday for a task just marked done, workspace-scoped', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, taskService } = buildService(client);

    const done = await taskService.createTask({ workspaceId, title: 'Ship the release' });
    await taskService.updateTask(workspaceId, done.id, { status: 'done' });
    const otherDone = await taskService.createTask({ workspaceId: otherWorkspaceId, title: 'Other workspace task' });
    await taskService.updateTask(otherWorkspaceId, otherDone.id, { status: 'done' });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.completedYesterday.length, 1);
    assert.equal(briefing.completedYesterday[0].id, done.id);
  });
});

test('getDailyBriefing excludes tasks completed more than 24h ago from completedYesterday', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, taskService } = buildService(client);

    const stale = await taskService.createTask({ workspaceId, title: 'Shipped a while ago' });
    await taskService.updateTask(workspaceId, stale.id, { status: 'done' });
    await client.query('UPDATE tasks SET updated_at = now() - interval \'2 days\' WHERE id = $1', [stale.id]);

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.deepEqual(briefing.completedYesterday, []);
  });
});

test('getDailyBriefing surfaces blockedItems/postponedItems from open tasks tagged via metadata.category, workspace-scoped', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { briefingService, taskService } = buildService(client);

    const blocked = await taskService.createTask({ workspaceId, title: 'Design review' });
    await taskService.updateTask(workspaceId, blocked.id, { metadata: { category: 'blocked' } });
    const postponed = await taskService.createTask({ workspaceId, title: 'Launch' });
    await taskService.updateTask(workspaceId, postponed.id, { metadata: { category: 'postponed' } });
    const otherBlocked = await taskService.createTask({ workspaceId: otherWorkspaceId, title: 'Other workspace blocked' });
    await taskService.updateTask(otherWorkspaceId, otherBlocked.id, { metadata: { category: 'blocked' } });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.equal(briefing.blockedItems.length, 1);
    assert.equal(briefing.blockedItems[0].id, blocked.id);
    assert.equal(briefing.postponedItems.length, 1);
    assert.equal(briefing.postponedItems[0].id, postponed.id);
  });
});

test('getDailyBriefing blockedItems/postponedItems exclude a task once it is marked done', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { briefingService, taskService } = buildService(client);

    const blocked = await taskService.createTask({ workspaceId, title: 'Design review' });
    await taskService.updateTask(workspaceId, blocked.id, { metadata: { category: 'blocked' } });
    await taskService.updateTask(workspaceId, blocked.id, { status: 'done' });

    const briefing = await briefingService.getDailyBriefing(workspaceId);

    assert.deepEqual(briefing.blockedItems, []);
  });
});

test('isBlockedTask requires an open task with metadata.category === blocked', () => {
  const base = {
    id: 't1',
    workspaceId: 'w1',
    title: 'x',
    description: null,
    priority: 'medium' as const,
    dueDate: null,
    source: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(isBlockedTask({ ...base, status: 'todo', metadata: { category: 'blocked' } }), true);
  assert.equal(isBlockedTask({ ...base, status: 'done', metadata: { category: 'blocked' } }), false);
  assert.equal(isBlockedTask({ ...base, status: 'todo', metadata: { category: 'postponed' } }), false);
});

test('isPostponedTask requires an open task with metadata.category === postponed', () => {
  const base = {
    id: 't1',
    workspaceId: 'w1',
    title: 'x',
    description: null,
    priority: 'medium' as const,
    dueDate: null,
    source: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(isPostponedTask({ ...base, status: 'todo', metadata: { category: 'postponed' } }), true);
  assert.equal(isPostponedTask({ ...base, status: 'done', metadata: { category: 'postponed' } }), false);
  assert.equal(isPostponedTask({ ...base, status: 'todo', metadata: { category: 'blocked' } }), false);
});

test('buildGreeting mentions the workspace name and picks a time-of-day salutation', () => {
  assert.equal(buildGreeting('RCS', new Date('2026-01-01T09:00:00')), "Good morning! Here's what's happening in RCS.");
  assert.equal(buildGreeting('RCS', new Date('2026-01-01T14:00:00')), "Good afternoon! Here's what's happening in RCS.");
  assert.equal(buildGreeting('RCS', new Date('2026-01-01T20:00:00')), "Good evening! Here's what's happening in RCS.");
});

test('needsAttention flags error status, enabled-but-disconnected, and an expired token', () => {
  const base = {
    workspaceId: 'w1',
    provider: 'github' as const,
    connectedAt: null,
    lastValidatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(needsAttention({ ...base, enabled: true, status: 'error', tokenExpiresAt: null }), true);
  assert.equal(needsAttention({ ...base, enabled: true, status: 'disconnected', tokenExpiresAt: null }), true);
  assert.equal(
    needsAttention({ ...base, enabled: true, status: 'connected', tokenExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    true,
  );
  assert.equal(needsAttention({ ...base, enabled: false, status: 'disconnected', tokenExpiresAt: null }), false);
  assert.equal(needsAttention({ ...base, enabled: true, status: 'connected', tokenExpiresAt: null }), false);
  assert.equal(
    needsAttention({ ...base, enabled: true, status: 'connected', tokenExpiresAt: new Date(Date.now() + 1000).toISOString() }),
    false,
  );
});
