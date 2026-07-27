import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { UserNotFoundError } from './errors';
import { UserService } from './userService';

test('createUser defaults preferences to an empty object and displayName to null', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    const user = await service.createUser({ email: `${randomUUID()}@example.com` });

    assert.equal(user.displayName, null);
    assert.deepEqual(user.preferences, {});
    assert.equal(user.communicationStyle, null);
    assert.equal(user.defaultWorkspaceId, null);
    assert.ok(user.createdAt);
    assert.ok(user.updatedAt);
  });
});

test('createUser accepts an explicit displayName', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    const user = await service.createUser({ email: `${randomUUID()}@example.com`, displayName: 'Roman' });

    assert.equal(user.displayName, 'Roman');
  });
});

test('getUser throws UserNotFoundError for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    await assert.rejects(() => service.getUser('00000000-0000-0000-0000-000000000000'), UserNotFoundError);
  });
});

test('updateProfile updates only the provided fields', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'rcs');
    const service = new UserService(client);

    const updated = await service.updateProfile(userId, {
      displayName: 'Roman',
      communicationStyle: 'direct and concise',
    });

    assert.equal(updated.displayName, 'Roman');
    assert.equal(updated.communicationStyle, 'direct and concise');
    assert.deepEqual(updated.preferences, {});
  });
});

test('updateProfile can set structured preferences', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'personal');
    const service = new UserService(client);

    const updated = await service.updateProfile(userId, { preferences: { theme: 'dark' } });
    assert.deepEqual(updated.preferences, { theme: 'dark' });
  });
});

test('updateProfile sets defaultWorkspaceId when it belongs to the user', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'mfs');
    const service = new UserService(client);

    const updated = await service.updateProfile(userId, { defaultWorkspaceId: workspaceId });
    assert.equal(updated.defaultWorkspaceId, workspaceId);
  });
});

test('updateProfile rejects a defaultWorkspaceId belonging to a different user', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new UserService(client);

    await assert.rejects(
      () => service.updateProfile(a.userId, { defaultWorkspaceId: b.workspaceId }),
      WorkspaceNotFoundError,
    );
  });
});

test('updateProfile throws UserNotFoundError for an unknown user', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    await assert.rejects(
      () => service.updateProfile('00000000-0000-0000-0000-000000000000', { displayName: 'x' }),
      UserNotFoundError,
    );
  });
});
