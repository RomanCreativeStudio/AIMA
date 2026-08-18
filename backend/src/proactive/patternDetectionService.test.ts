import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { MemoryService } from '../memory/memoryService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { TaskService } from '../tasks/taskService';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowService } from '../workflows/workflowService';
import { WorkspaceService } from '../workspaces/workspaceService';
import { PatternDetectionService } from './patternDetectionService';
import type { Pattern, PatternType } from './types';

function buildService(client: Client, overdueGraceDays?: number) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const taskService = new TaskService(client);
  const workspaceService = new WorkspaceService(client);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const workflowRegistry = new WorkflowRegistry();
  const workflowService = new WorkflowService(client, workflowRegistry, {} as Record<WorkflowKey, WorkflowHandler>, approvalEngine);
  const service = new PatternDetectionService(
    workspaceService,
    taskService,
    workflowService,
    approvalEngine,
    actionLogger,
    memoryService,
    overdueGraceDays,
  );

  return { service, taskService, approvalEngine, workflowService, memoryService, permissionEngine, actionLogger };
}

function patternsOfType(patterns: readonly Pattern[], type: PatternType): Pattern[] {
  return patterns.filter((p) => p.type === type);
}

test('detect rejects an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    const { service } = buildService(client);
    await assert.rejects(service.detect('00000000-0000-0000-0000-000000000000'), WorkspaceNotFoundError);
  });
});

test('detect returns only the two always-present trend patterns for a brand-new workspace', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service } = buildService(client);

    const patterns = await service.detect(workspaceId);

    assert.equal(patterns.length, 2);
    assert.ok(patterns.every((p) => p.type === 'activity_trend' || p.type === 'memory_usage_trend'));
    assert.ok(patterns.every((p) => p.workspaceId === workspaceId));
  });
});

test('detects a repeated_task pattern when 2+ open tasks share a title keyword', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    await taskService.createTask({ workspaceId, title: 'Draft the Acme proposal' });
    await taskService.createTask({ workspaceId, title: 'Follow up on Acme proposal' });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'repeated_task');

    assert.ok(pattern);
    assert.equal(pattern.metadata.keyword, 'acme');
    assert.equal(pattern.occurrences, 2);
    assert.ok(pattern.confidence >= 0.5 && pattern.confidence <= 1);
  });
});

test('repeated_task ignores done/cancelled tasks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    const first = await taskService.createTask({ workspaceId, title: 'Draft the Acme proposal' });
    await taskService.updateTask(workspaceId, first.id, { status: 'done' });
    await taskService.createTask({ workspaceId, title: 'Follow up on Acme proposal' });

    const patterns = await service.detect(workspaceId);
    assert.equal(patternsOfType(patterns, 'repeated_task').length, 0);
  });
});

test('detects a frequent_workflow pattern when the same workflow runs 2+ times', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, workflowService } = buildService(client);

    await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'frequent_workflow');

    assert.ok(pattern);
    assert.equal(pattern.metadata.workflowKey, 'daily_workspace_briefing');
    assert.equal(pattern.occurrences, 2);
  });
});

test('detects a recurring_approval pattern when the same action type requires approval 2+ times', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, approvalEngine } = buildService(client);

    await approvalEngine.evaluate(workspaceId, 'send_email', { to: 'a@example.com' });
    await approvalEngine.evaluate(workspaceId, 'send_email', { to: 'b@example.com' });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'recurring_approval');

    assert.ok(pattern);
    assert.equal(pattern.metadata.actionType, 'send_email');
    assert.equal(pattern.occurrences, 2);
  });
});

test('detects a missed_deadline pattern for overdue open tasks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Overdue task', dueDate: yesterday });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'missed_deadline');

    assert.ok(pattern);
    assert.equal(pattern.occurrences, 1);
    assert.ok(pattern.confidence >= 0.5);
  });
});

test('missed_deadline is absent when nothing is overdue', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Not due yet', dueDate: tomorrow });

    const patterns = await service.detect(workspaceId);
    assert.equal(patternsOfType(patterns, 'missed_deadline').length, 0);
  });
});

test('missed_deadline respects a configurable overdueGraceDays threshold', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client, 2);

    const oneDayOverdue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Barely overdue', dueDate: oneDayOverdue });

    const patterns = await service.detect(workspaceId);

    assert.equal(patternsOfType(patterns, 'missed_deadline').length, 0, 'a 1-day-overdue task must not trigger a 2-day grace threshold');
  });
});

test('missed_deadline fires once the overdueGraceDays threshold is met', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client, 2);

    const threeDaysOverdue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Well overdue', dueDate: threeDaysOverdue });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'missed_deadline');

    assert.ok(pattern);
    assert.equal(pattern.occurrences, 1);
  });
});

test('detects a blocked_task_stale pattern for a blocked task untouched for 3+ days', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    const blocked = await taskService.createTask({ workspaceId, title: 'Design review' });
    await taskService.updateTask(workspaceId, blocked.id, { metadata: { category: 'blocked' } });
    await client.query("UPDATE tasks SET updated_at = now() - interval '4 days' WHERE id = $1", [blocked.id]);

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'blocked_task_stale');

    assert.ok(pattern);
    assert.equal(pattern.occurrences, 1);
    assert.deepEqual(pattern.metadata.taskIds, [blocked.id]);
  });
});

test('blocked_task_stale is absent for a blocked task tagged less than 3 days ago', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    const blocked = await taskService.createTask({ workspaceId, title: 'Design review' });
    await taskService.updateTask(workspaceId, blocked.id, { metadata: { category: 'blocked' } });

    const patterns = await service.detect(workspaceId);

    assert.equal(patternsOfType(patterns, 'blocked_task_stale').length, 0);
  });
});

test('detects a decision_without_followup pattern for a decision with no related task created afterward', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, memoryService } = buildService(client);

    const decision = await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "We've decided to migrate the database to Postgres.",
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'decision_without_followup');

    assert.ok(pattern);
    assert.equal(pattern.occurrences, 1);
    assert.deepEqual(pattern.metadata.memoryIds, [decision.id]);
  });
});

test('decision_without_followup is absent once a matching task is created after the decision', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, memoryService, taskService } = buildService(client);

    const decision = await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: "We've decided to migrate the database to Postgres.",
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });
    // Backdate the decision: withTestTransaction runs both inserts under one transaction, so under READ
    // COMMITTED now() is frozen for its duration — the decision and the task below would otherwise share the
    // exact same created_at, and hasFollowUpTask requires a task created strictly after the decision.
    await client.query("UPDATE memory_records SET created_at = now() - interval '1 hour' WHERE id = $1", [decision.id]);
    await taskService.createTask({ workspaceId, title: 'Migrate the database to Postgres' });

    const patterns = await service.detect(workspaceId);

    assert.equal(patternsOfType(patterns, 'decision_without_followup').length, 0);
  });
});

test('activity_trend reports increasing when recent activity exists with nothing prior', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, permissionEngine, actionLogger } = buildService(client);

    await actionLogger.log({ workspaceId, tier: permissionEngine.resolveTier('create_task'), summary: 'Did something', outcome: 'success' });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'activity_trend');

    assert.ok(pattern);
    assert.equal(pattern.metadata.direction, 'increasing');
  });
});

test('memory_usage_trend reports increasing when recent memories exist with nothing prior', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, memoryService } = buildService(client);

    await memoryService.createMemory({ workspaceId, scope: 'workspace', content: 'A new memory.' });

    const patterns = await service.detect(workspaceId);
    const [pattern] = patternsOfType(patterns, 'memory_usage_trend');

    assert.ok(pattern);
    assert.equal(pattern.metadata.direction, 'increasing');
  });
});

test('patterns are isolated per workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { service, taskService } = buildService(client);

    await taskService.createTask({ workspaceId: a.workspaceId, title: 'Draft the Acme proposal' });
    await taskService.createTask({ workspaceId: a.workspaceId, title: 'Call the Acme team' });

    const patternsA = await service.detect(a.workspaceId);
    const patternsB = await service.detect(b.workspaceId);

    assert.equal(patternsOfType(patternsA, 'repeated_task').length, 1);
    assert.equal(patternsOfType(patternsB, 'repeated_task').length, 0);
  });
});

test('blocked_task_stale and decision_without_followup patterns are isolated per workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { service, taskService, memoryService } = buildService(client);

    const blocked = await taskService.createTask({ workspaceId: b.workspaceId, title: 'Other workspace blocked task' });
    await taskService.updateTask(b.workspaceId, blocked.id, { metadata: { category: 'blocked' } });
    await client.query("UPDATE tasks SET updated_at = now() - interval '4 days' WHERE id = $1", [blocked.id]);
    await memoryService.createMemory({
      workspaceId: b.workspaceId,
      scope: 'workspace',
      content: 'A decision in the other workspace.',
      source: 'auto_extracted',
      metadata: { category: 'decision' },
    });

    const patternsA = await service.detect(a.workspaceId);

    assert.equal(patternsOfType(patternsA, 'blocked_task_stale').length, 0);
    assert.equal(patternsOfType(patternsA, 'decision_without_followup').length, 0);
  });
});
