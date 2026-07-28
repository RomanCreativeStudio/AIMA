import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { TaskService } from '../tasks/taskService';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowService } from '../workflows/workflowService';
import { WorkspaceService } from '../workspaces/workspaceService';
import { BriefingService } from './briefingService';

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

  return { briefingService, taskService, approvalEngine, workflowService, actionLogger, permissionEngine };
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
