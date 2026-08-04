import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { TaskNotFoundError } from './errors';
import { TaskService } from './taskService';

test('createTask defaults priority to medium and status to todo', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId, title: 'Follow up with Acme' });

    assert.equal(task.workspaceId, workspaceId);
    assert.equal(task.title, 'Follow up with Acme');
    assert.equal(task.status, 'todo');
    assert.equal(task.priority, 'medium');
    assert.equal(task.description, null);
    assert.ok(task.createdAt);
    assert.ok(task.updatedAt);
  });
});

test('createTask accepts an explicit priority and description', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new TaskService(client);

    const task = await service.createTask({
      workspaceId,
      title: 'Ship the release',
      description: 'Cut v2.0 and notify the team.',
      priority: 'high',
    });

    assert.equal(task.priority, 'high');
    assert.equal(task.description, 'Cut v2.0 and notify the team.');
  });
});

test('createTask rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new TaskService(client);
    await assert.rejects(
      () => service.createTask({ workspaceId: '00000000-0000-0000-0000-000000000000', title: 'x' }),
      WorkspaceNotFoundError,
    );
  });
});

test('listTasks is scoped to the workspace and can filter by status', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new TaskService(client);

    const todo = await service.createTask({ workspaceId: a.workspaceId, title: 'Todo task' });
    await service.createTask({ workspaceId: a.workspaceId, title: 'Another task' });
    await service.createTask({ workspaceId: b.workspaceId, title: 'Task in another workspace' });
    await service.updateTask(a.workspaceId, todo.id, { status: 'done' });

    const allInA = await service.listTasks(a.workspaceId);
    assert.equal(allInA.length, 2);
    assert.ok(allInA.every((task) => task.workspaceId === a.workspaceId));

    const doneInA = await service.listTasks(a.workspaceId, 'done');
    assert.equal(doneInA.length, 1);
    assert.equal(doneInA[0].id, todo.id);
  });
});

test('getTask throws TaskNotFoundError for an id in a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId: a.workspaceId, title: 'x' });

    await assert.rejects(() => service.getTask(b.workspaceId, task.id), TaskNotFoundError);
  });
});

test('updateTask updates only the provided fields', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId, title: 'Fix bug', priority: 'low' });
    const updated = await service.updateTask(workspaceId, task.id, { status: 'in_progress' });

    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.title, 'Fix bug');
    assert.equal(updated.priority, 'low');
  });
});

test('updateTask replaces metadata wholesale when provided, without touching status/dueDate', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId, title: 'Design review', metadata: { category: 'todo' } });
    const updated = await service.updateTask(workspaceId, task.id, { metadata: { category: 'blocked' } });

    assert.deepEqual(updated.metadata, { category: 'blocked' });
    assert.equal(updated.status, 'todo');
    assert.equal(updated.dueDate, null);
  });
});

test('updateTask leaves metadata untouched when not provided', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId, title: 'Design review', metadata: { category: 'blocked' } });
    const updated = await service.updateTask(workspaceId, task.id, { status: 'in_progress' });

    assert.deepEqual(updated.metadata, { category: 'blocked' });
  });
});

test('updateTask throws TaskNotFoundError for a cross-workspace id', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId: a.workspaceId, title: 'x' });

    await assert.rejects(() => service.updateTask(b.workspaceId, task.id, { status: 'done' }), TaskNotFoundError);

    const stillTodo = await service.getTask(a.workspaceId, task.id);
    assert.equal(stillTodo.status, 'todo');
  });
});

test('deleteTask removes the task; throws for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId, title: 'Delete me' });
    await service.deleteTask(workspaceId, task.id);

    await assert.rejects(() => service.getTask(workspaceId, task.id), TaskNotFoundError);
    await assert.rejects(() => service.deleteTask(workspaceId, task.id), TaskNotFoundError);
  });
});

test('deleteTask throws TaskNotFoundError when the id belongs to a different workspace and does not delete it', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new TaskService(client);

    const task = await service.createTask({ workspaceId: a.workspaceId, title: 'Protected' });

    await assert.rejects(() => service.deleteTask(b.workspaceId, task.id), TaskNotFoundError);

    const stillThere = await service.getTask(a.workspaceId, task.id);
    assert.equal(stillThere.id, task.id);
  });
});
