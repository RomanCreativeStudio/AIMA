import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { TaskService } from '../tasks/taskService';
import { TaskIntelligenceService } from './taskIntelligenceService';

const FIXED_NOW = new Date('2026-07-28T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

test('analyze excludes done/cancelled tasks from every list', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const taskService = new TaskService(client);
    const service = new TaskIntelligenceService(taskService);

    const done = await taskService.createTask({ workspaceId, title: 'Finished thing' });
    await taskService.updateTask(workspaceId, done.id, { status: 'done' });
    await taskService.createTask({ workspaceId, title: 'Open thing' });

    const result = await service.analyze(workspaceId, { now: () => FIXED_NOW });

    assert.equal(result.suggestedPriorities.length, 1);
    assert.equal(result.suggestedPriorities[0].title, 'Open thing');
  });
});

test('analyze buckets overdue and due-soon tasks correctly', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const taskService = new TaskService(client);
    const service = new TaskIntelligenceService(taskService);

    const overdueTask = await taskService.createTask({
      workspaceId,
      title: 'Late thing',
      dueDate: new Date(FIXED_NOW.getTime() - DAY_MS).toISOString(),
    });
    const dueSoonTask = await taskService.createTask({
      workspaceId,
      title: 'Soon thing',
      dueDate: new Date(FIXED_NOW.getTime() + DAY_MS).toISOString(),
    });
    await taskService.createTask({
      workspaceId,
      title: 'Far off thing',
      dueDate: new Date(FIXED_NOW.getTime() + 30 * DAY_MS).toISOString(),
    });

    const result = await service.analyze(workspaceId, { now: () => FIXED_NOW });

    assert.deepEqual(result.overdue.map((task) => task.id), [overdueTask.id]);
    assert.deepEqual(result.dueSoon.map((task) => task.id), [dueSoonTask.id]);
  });
});

test('analyze respects a custom dueSoonWindowMs', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const taskService = new TaskService(client);
    const service = new TaskIntelligenceService(taskService);

    await taskService.createTask({
      workspaceId,
      title: 'In ten days',
      dueDate: new Date(FIXED_NOW.getTime() + 10 * DAY_MS).toISOString(),
    });

    const narrow = await service.analyze(workspaceId, { now: () => FIXED_NOW, dueSoonWindowMs: 3 * DAY_MS });
    assert.deepEqual(narrow.dueSoon, []);

    const wide = await service.analyze(workspaceId, { now: () => FIXED_NOW, dueSoonWindowMs: 14 * DAY_MS });
    assert.equal(wide.dueSoon.length, 1);
  });
});

test('analyze groups related open tasks by shared title keywords', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const taskService = new TaskService(client);
    const service = new TaskIntelligenceService(taskService);

    await taskService.createTask({ workspaceId, title: 'Draft Acme proposal' });
    await taskService.createTask({ workspaceId, title: 'Send Acme invoice' });
    await taskService.createTask({ workspaceId, title: 'Buy coffee filters' });

    const result = await service.analyze(workspaceId, { now: () => FIXED_NOW });

    const acmeGroup = result.relatedGroups.find((group) => group.keyword === 'acme');
    assert.ok(acmeGroup);
    assert.equal(acmeGroup!.taskIds.length, 2);
  });
});

test('analyze returns an empty, well-formed result for a workspace with no tasks', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const taskService = new TaskService(client);
    const service = new TaskIntelligenceService(taskService);

    const result = await service.analyze(workspaceId, { now: () => FIXED_NOW });

    assert.equal(result.workspaceId, workspaceId);
    assert.deepEqual(result.suggestedPriorities, []);
    assert.deepEqual(result.dueSoon, []);
    assert.deepEqual(result.overdue, []);
    assert.deepEqual(result.relatedGroups, []);
    assert.ok(result.generatedAt);
  });
});
