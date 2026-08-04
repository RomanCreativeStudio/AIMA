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

// getOrProvisionFromAuth (ADR-0022 v1.1, EPIC-006 Sprint 6.4) — the login
// route's auto-provisioning path for a verified Supabase Auth identity with
// no matching public.users row yet.

test('getOrProvisionFromAuth creates a profile using the given id/email, leaving displayName null', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    const id = randomUUID();
    const email = `${randomUUID()}@example.com`;

    const user = await service.getOrProvisionFromAuth(id, email);

    assert.equal(user.id, id);
    assert.equal(user.email, email);
    assert.equal(user.displayName, null);
    assert.deepEqual(user.preferences, {});
  });
});

test('getOrProvisionFromAuth is idempotent — a second call for the same id returns the same row, not a duplicate', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    const id = randomUUID();
    const email = `${randomUUID()}@example.com`;

    const first = await service.getOrProvisionFromAuth(id, email);
    const second = await service.getOrProvisionFromAuth(id, email);

    assert.equal(second.id, first.id);
    assert.equal(second.createdAt, first.createdAt);

    const rows = await client.query('SELECT count(*)::int AS count FROM users WHERE id = $1', [id]);
    assert.equal(rows.rows[0].count, 1);
  });
});

test('getOrProvisionFromAuth returns an already-existing profile untouched — never overwrites it', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'personal');
    const service = new UserService(client);
    const existing = await service.getUser(userId);

    const result = await service.getOrProvisionFromAuth(userId, 'different-email-should-be-ignored@example.com');

    assert.equal(result.id, existing.id);
    assert.equal(result.email, existing.email);
  });
});

// Default workspace provisioning (Workspace Provisioning sprint) — getOrProvisionFromAuth also ensures the
// profile has at least one workspace, closing the beta-blocking gap where a brand-new account got a users row
// but no workspace and no way to get one.

test('getOrProvisionFromAuth creates a default workspace for a brand-new profile and links it via defaultWorkspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    const id = randomUUID();
    const email = `${randomUUID()}@example.com`;

    const user = await service.getOrProvisionFromAuth(id, email);

    assert.ok(user.defaultWorkspaceId, 'a brand-new profile must come back with a default workspace already set');

    const rows = await client.query('SELECT id, user_id, slug, name FROM workspaces WHERE user_id = $1', [id]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].id, user.defaultWorkspaceId);
    assert.equal(rows.rows[0].slug, 'personal');
  });
});

test('getOrProvisionFromAuth does not create a second workspace on a repeated call for the same new user', async () => {
  await withTestTransaction(async (client) => {
    const service = new UserService(client);
    const id = randomUUID();
    const email = `${randomUUID()}@example.com`;

    const first = await service.getOrProvisionFromAuth(id, email);
    const second = await service.getOrProvisionFromAuth(id, email);

    assert.equal(second.defaultWorkspaceId, first.defaultWorkspaceId);
    const rows = await client.query('SELECT count(*)::int AS count FROM workspaces WHERE user_id = $1', [id]);
    assert.equal(rows.rows[0].count, 1);
  });
});

test('getOrProvisionFromAuth never creates a workspace for an existing user who already has one', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'rcs');
    const service = new UserService(client);

    const result = await service.getOrProvisionFromAuth(userId, 'ignored@example.com');

    // seedWorkspace does not itself set default_workspace_id — provisioning must not backfill it for an
    // account that already had a workspace before this call; only first-time provisioning ever sets it.
    assert.equal(result.defaultWorkspaceId, null);
    const rows = await client.query('SELECT count(*)::int AS count FROM workspaces WHERE user_id = $1', [userId]);
    assert.equal(rows.rows[0].count, 1);
  });
});

test('the auto-provisioned workspace belongs only to the provisioned user', async () => {
  await withTestTransaction(async (client) => {
    const other = await seedWorkspace(client, 'rcs');
    const service = new UserService(client);
    const id = randomUUID();

    const user = await service.getOrProvisionFromAuth(id, `${randomUUID()}@example.com`);

    const rows = await client.query<{ user_id: string }>('SELECT user_id FROM workspaces WHERE id = $1', [
      user.defaultWorkspaceId,
    ]);
    assert.equal(rows.rows[0].user_id, id);
    assert.notEqual(rows.rows[0].user_id, other.userId);
  });
});

test('getOrProvisionFromAuth recovers a user row left with zero workspaces by a prior incomplete provisioning attempt', async () => {
  await withTestTransaction(async (client) => {
    // Simulates a process that inserted the users row but died before ever creating a workspace — the exact
    // state the old getOrProvisionFromAuth (before this sprint) always left a brand-new account in.
    const id = randomUUID();
    const email = `${randomUUID()}@example.com`;
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, email]);
    const service = new UserService(client);

    const recovered = await service.getOrProvisionFromAuth(id, email);

    assert.ok(recovered.defaultWorkspaceId, 'a subsequent call must finish the interrupted provisioning, not leave the account stuck');
    const rows = await client.query('SELECT count(*)::int AS count FROM workspaces WHERE user_id = $1', [id]);
    assert.equal(rows.rows[0].count, 1);
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

// Beta status (Beta Tester Infrastructure sprint) — no dedicated column or endpoint; audited and confirmed
// the existing generic `preferences` blob already round-trips an arbitrary beta-status marker with zero
// schema changes, the same way it already carries `onboardingCompleted`.

test('updateProfile can set a beta-tester marker in preferences', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'personal');
    const service = new UserService(client);

    const updated = await service.updateProfile(userId, { preferences: { betaTester: true } });

    assert.deepEqual(updated.preferences, { betaTester: true });
  });
});

test('a profile that never had its beta status set has it absent, not defaulted to true or false', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'rcs');
    const service = new UserService(client);

    const user = await service.getUser(userId);

    assert.deepEqual(user.preferences, {});
    assert.equal((user.preferences as Record<string, unknown>).betaTester, undefined);
  });
});

test('setting a beta-tester marker does not disturb other existing preference keys', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'mfs');
    const service = new UserService(client);
    await service.updateProfile(userId, { preferences: { theme: 'dark', onboardingCompleted: true } });

    const updated = await service.updateProfile(userId, {
      preferences: { theme: 'dark', onboardingCompleted: true, betaTester: true },
    });

    assert.deepEqual(updated.preferences, { theme: 'dark', onboardingCompleted: true, betaTester: true });
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
