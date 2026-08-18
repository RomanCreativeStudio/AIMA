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
import { summarizeApprovals, summarizeTasks, summarizeWorkflowRuns, WorkspaceInsightsService } from './workspaceInsightsService';

function buildService(client: Client) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const taskService = new TaskService(client);
  const workspaceService = new WorkspaceService(client);
  const actionLogger = new ActionLogger(client);
  const workflowRegistry = new WorkflowRegistry();
  const workflowService = new WorkflowService(client, workflowRegistry, {} as Record<WorkflowKey, WorkflowHandler>, approvalEngine);
  const insightsService = new WorkspaceInsightsService(workspaceService, actionLogger, workflowService, approvalEngine, taskService);

  return { insightsService, taskService, approvalEngine, workflowService, actionLogger, permissionEngine };
}

test('getInsights rejects an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    const { insightsService } = buildService(client);
    await assert.rejects(
      insightsService.getInsights('00000000-0000-0000-0000-000000000000'),
      WorkspaceNotFoundError,
    );
  });
});

test('getInsights reports all-zero metrics for a brand-new workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { insightsService } = buildService(client);

    const insights = await insightsService.getInsights(workspaceId);

    assert.deepEqual(insights.activityMetrics, { totalActions: 0, successfulActions: 0, failedActions: 0 });
    assert.equal(insights.workflowMetrics.totalRuns, 0);
    assert.equal(insights.approvalMetrics.total, 0);
    assert.deepEqual(insights.taskMetrics, { total: 0, todo: 0, inProgress: 0, done: 0, cancelled: 0, completionRate: 0 });
  });
});

test('getInsights aggregates metrics scoped to the workspace only', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { insightsService, taskService, approvalEngine, workflowService, actionLogger, permissionEngine } =
      buildService(client);

    const t1 = await taskService.createTask({ workspaceId, title: 'a' });
    await taskService.updateTask(workspaceId, t1.id, { status: 'done' });
    await taskService.createTask({ workspaceId, title: 'b' });
    await taskService.createTask({ workspaceId: otherWorkspaceId, title: 'other' });

    await approvalEngine.evaluate(workspaceId, 'send_email', {});
    await approvalEngine.evaluate(otherWorkspaceId, 'send_email', {});

    const run = await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.cancel(workspaceId, run.id);
    await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.createRun({ workspaceId: otherWorkspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    await actionLogger.log({ workspaceId, tier: permissionEngine.resolveTier('create_task'), summary: 'x', outcome: 'success' });
    await actionLogger.log({ workspaceId, tier: permissionEngine.resolveTier('create_task'), summary: 'y', outcome: 'failure' });
    await actionLogger.log({ workspaceId: otherWorkspaceId, tier: permissionEngine.resolveTier('create_task'), summary: 'z', outcome: 'success' });

    const insights = await insightsService.getInsights(workspaceId);

    assert.deepEqual(insights.activityMetrics, { totalActions: 2, successfulActions: 1, failedActions: 1 });
    assert.equal(insights.approvalMetrics.total, 1);
    assert.equal(insights.approvalMetrics.pending, 1);
    assert.equal(insights.workflowMetrics.totalRuns, 2);
    assert.equal(insights.workflowMetrics.activeRuns, 1);
    assert.equal(insights.workflowMetrics.byStatus.cancelled, 1);
    assert.equal(insights.workflowMetrics.byStatus.pending, 1);
    assert.equal(insights.taskMetrics.total, 2);
    assert.equal(insights.taskMetrics.done, 1);
    assert.equal(insights.taskMetrics.completionRate, 0.5);
  });
});

test('summarizeApprovals counts every status, defaulting unseen statuses to zero', () => {
  const metrics = summarizeApprovals(['pending', 'pending', 'approved', 'rejected']);
  assert.deepEqual(metrics, { total: 4, pending: 2, approved: 1, rejected: 1, expired: 0 });
});

test('summarizeTasks computes a zero completionRate for an empty task list', () => {
  const metrics = summarizeTasks([]);
  assert.deepEqual(metrics, { total: 0, todo: 0, inProgress: 0, done: 0, cancelled: 0, completionRate: 0 });
});

test('summarizeWorkflowRuns tallies active vs. completed runs', () => {
  const metrics = summarizeWorkflowRuns([
    { id: '1', workspaceId: 'w', workflowKey: 'daily_workspace_briefing', status: 'running', currentStepIndex: 0, input: {}, result: null, createdAt: '', updatedAt: '', completedAt: null },
    { id: '2', workspaceId: 'w', workflowKey: 'daily_workspace_briefing', status: 'completed', currentStepIndex: 2, input: {}, result: null, createdAt: '', updatedAt: '', completedAt: '' },
    { id: '3', workspaceId: 'w', workflowKey: 'daily_workspace_briefing', status: 'awaiting_approval', currentStepIndex: 0, input: {}, result: null, createdAt: '', updatedAt: '', completedAt: null },
  ]);

  assert.equal(metrics.totalRuns, 3);
  assert.equal(metrics.activeRuns, 2);
  assert.equal(metrics.completedRuns, 1);
  assert.equal(metrics.byStatus.running, 1);
  assert.equal(metrics.byStatus.awaiting_approval, 1);
});
