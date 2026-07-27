import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { UserNotFoundError } from '../users/errors';
import { UserService } from '../users/userService';
import { WorkspaceNotFoundError } from '../types/errors';
import { WorkspaceAlreadyExistsError } from './errors';
import { WorkspaceService } from './workspaceService';

test('createWorkspace defaults type from the slug-based mapping', async () => {
  await withTestTransaction(async (client) => {
    const userService = new UserService(client);
    const user = await userService.createUser({ email: `${randomUUID()}@example.com` });
    const service = new WorkspaceService(client);

    const workspace = await service.createWorkspace({ userId: user.id, slug: 'mfs', name: 'Mythic Forge Studios' });

    assert.equal(workspace.slug, 'mfs');
    assert.equal(workspace.type, 'creative');
    assert.equal(workspace.instructions, null);
    assert.deepEqual(workspace.assistantBehavior, {});
    assert.deepEqual(workspace.metadata, {});
    assert.ok(workspace.createdAt);
    assert.ok(workspace.updatedAt);
  });
});

test('createWorkspace accepts explicit type, instructions, assistantBehavior, and metadata', async () => {
  await withTestTransaction(async (client) => {
    const userService = new UserService(client);
    const user = await userService.createUser({ email: `${randomUUID()}@example.com` });
    const service = new WorkspaceService(client);

    const workspace = await service.createWorkspace({
      userId: user.id,
      slug: 'rcs',
      name: 'Roman Creative Studio',
      type: 'business',
      instructions: 'Always mention the project deadline.',
      assistantBehavior: { tone: 'formal' },
      metadata: { region: 'us' },
    });

    assert.equal(workspace.type, 'business');
    assert.equal(workspace.instructions, 'Always mention the project deadline.');
    assert.deepEqual(workspace.assistantBehavior, { tone: 'formal' });
    assert.deepEqual(workspace.metadata, { region: 'us' });
  });
});

test('createWorkspace rejects an unknown userId', async () => {
  await withTestTransaction(async (client) => {
    const service = new WorkspaceService(client);
    await assert.rejects(
      () => service.createWorkspace({ userId: '00000000-0000-0000-0000-000000000000', slug: 'personal', name: 'x' }),
      UserNotFoundError,
    );
  });
});

test('createWorkspace rejects a duplicate slug for the same user', async () => {
  await withTestTransaction(async (client) => {
    const userService = new UserService(client);
    const user = await userService.createUser({ email: `${randomUUID()}@example.com` });
    const service = new WorkspaceService(client);

    await service.createWorkspace({ userId: user.id, slug: 'personal', name: 'Personal' });

    await assert.rejects(
      () => service.createWorkspace({ userId: user.id, slug: 'personal', name: 'Personal Again' }),
      WorkspaceAlreadyExistsError,
    );
  });
});

test('getWorkspace throws WorkspaceNotFoundError for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    const service = new WorkspaceService(client);
    await assert.rejects(
      () => service.getWorkspace('00000000-0000-0000-0000-000000000000'),
      WorkspaceNotFoundError,
    );
  });
});

test('getWorkspace resolves the slug-based default type for a workspace with no stored type', async () => {
  await withTestTransaction(async (client) => {
    // seedWorkspace inserts directly via SQL (no `type` column supplied), the
    // same as every other pre-Phase-1.8 test helper — proving the fallback works.
    const { workspaceId } = await seedWorkspace(client, 'development');
    const service = new WorkspaceService(client);

    const workspace = await service.getWorkspace(workspaceId);
    assert.equal(workspace.type, 'development');
  });
});

test('listWorkspaces is scoped to the user and isolated from other users', async () => {
  await withTestTransaction(async (client) => {
    const userService = new UserService(client);
    const a = await userService.createUser({ email: `${randomUUID()}@example.com` });
    const b = await userService.createUser({ email: `${randomUUID()}@example.com` });
    const service = new WorkspaceService(client);

    await service.createWorkspace({ userId: a.id, slug: 'personal', name: 'A Personal' });
    await service.createWorkspace({ userId: a.id, slug: 'rcs', name: 'A RCS' });
    await service.createWorkspace({ userId: b.id, slug: 'personal', name: 'B Personal' });

    const workspacesForA = await service.listWorkspaces(a.id);
    assert.equal(workspacesForA.length, 2);
    assert.ok(workspacesForA.every((workspace) => workspace.userId === a.id));
  });
});

test('updateWorkspace updates only the provided fields', async () => {
  await withTestTransaction(async (client) => {
    const userService = new UserService(client);
    const user = await userService.createUser({ email: `${randomUUID()}@example.com` });
    const service = new WorkspaceService(client);

    const workspace = await service.createWorkspace({ userId: user.id, slug: 'development', name: 'Dev' });
    const updated = await service.updateWorkspace(workspace.id, { instructions: 'Prefer TypeScript.' });

    assert.equal(updated.instructions, 'Prefer TypeScript.');
    assert.equal(updated.name, 'Dev');
    assert.equal(updated.type, 'development');
  });
});

test('updateWorkspace throws WorkspaceNotFoundError for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    const service = new WorkspaceService(client);
    await assert.rejects(
      () => service.updateWorkspace('00000000-0000-0000-0000-000000000000', { name: 'x' }),
      WorkspaceNotFoundError,
    );
  });
});
