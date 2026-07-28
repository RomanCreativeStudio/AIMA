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
import { BriefingService } from './briefingService';

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
  );

  return { ...base, briefingService, memoryService, proactiveIntelligenceService };
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
