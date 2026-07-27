import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { ApprovalEngine } from './approvalEngine';
import {
  PendingApprovalAlreadyResolvedError,
  PendingApprovalExpiredError,
  PendingApprovalNotFoundError,
  UnregisteredCapabilityError,
} from './errors';

test('evaluate returns no_approval_needed for a Tier 2 capability, with no DB row created', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const decision = await engine.evaluate(workspaceId, 'create_memory', { content: 'x' });
    assert.deepEqual(decision, { state: 'no_approval_needed' });

    const rows = await client.query('SELECT 1 FROM pending_approvals WHERE workspace_id = $1', [workspaceId]);
    assert.equal(rows.rows.length, 0);
  });
});

test('evaluate creates a pending approval for a Tier 3 capability (send_email)', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const decision = await engine.evaluate(workspaceId, 'send_email', { to: 'client@example.com' });
    assert.equal(decision.state, 'pending');
    assert.ok(decision.pendingApprovalId);

    const row = await client.query('SELECT status, workspace_id, expires_at FROM pending_approvals WHERE id = $1', [
      decision.pendingApprovalId,
    ]);
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].status, 'pending');
    assert.equal(row.rows[0].workspace_id, workspaceId);
    assert.ok(new Date(row.rows[0].expires_at).getTime() > Date.now());
  });
});

test('evaluate throws for a capability that has not been synced to the database', async () => {
  await withTestTransaction(async (client) => {
    // Deliberately skip seedCapabilities() and use a capability name that
    // only exists in this test's in-memory registry — proving evaluate()
    // needs the DB row specifically, regardless of what other capabilities
    // (e.g. send_email) the shared test database already has synced from
    // other test runs (docs/README.md: the test DB is never reset between
    // runs, and syncCapabilitiesToDatabase is meant to be safely idempotent).
    const registry = new CapabilityRegistry([
      { actionType: 'never_synced_capability', defaultTier: 'execute_with_approval', tierLocked: false, description: '' },
    ]);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(registry));

    await assert.rejects(
      () => engine.evaluate(workspaceId, 'never_synced_capability', {}),
      UnregisteredCapabilityError,
    );
  });
});

test('approve transitions a pending approval to approved', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', {});
    const approved = await engine.approve(workspaceId, created.pendingApprovalId!);

    assert.equal(approved.state, 'approved');

    const status = await engine.getStatus(workspaceId, created.pendingApprovalId!);
    assert.equal(status.state, 'approved');
  });
});

test('reject transitions a pending approval to rejected', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', {});
    const rejected = await engine.reject(workspaceId, created.pendingApprovalId!);

    assert.equal(rejected.state, 'rejected');
  });
});

test('approve throws PendingApprovalNotFoundError for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    await assert.rejects(
      () => engine.approve(workspaceId, '00000000-0000-0000-0000-000000000000'),
      PendingApprovalNotFoundError,
    );
  });
});

test('approve throws PendingApprovalNotFoundError when the id belongs to a different workspace (isolation)', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(a.workspaceId, 'send_email', {});

    await assert.rejects(
      () => engine.approve(b.workspaceId, created.pendingApprovalId!),
      PendingApprovalNotFoundError,
    );

    // Confirm it's untouched — still pending under workspace A.
    const status = await engine.getStatus(a.workspaceId, created.pendingApprovalId!);
    assert.equal(status.state, 'pending');
  });
});

test('approve throws PendingApprovalAlreadyResolvedError on a second call', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', {});
    await engine.approve(workspaceId, created.pendingApprovalId!);

    await assert.rejects(
      () => engine.approve(workspaceId, created.pendingApprovalId!),
      PendingApprovalAlreadyResolvedError,
    );
  });
});

test('getStatus throws PendingApprovalNotFoundError for an unknown id and does not mutate state', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    await assert.rejects(
      () => engine.getStatus(workspaceId, '00000000-0000-0000-0000-000000000000'),
      PendingApprovalNotFoundError,
    );
  });
});

test('a pending approval past its expiry reports as expired without a background job', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', {});
    // Force it into the past directly — no clock mocking needed, and this
    // proves expiry is computed from the stored value, not cached in memory.
    await client.query('UPDATE pending_approvals SET expires_at = now() - interval \'1 hour\' WHERE id = $1', [
      created.pendingApprovalId,
    ]);

    const status = await engine.getStatus(workspaceId, created.pendingApprovalId!);
    assert.equal(status.state, 'expired');
  });
});

test('approve throws PendingApprovalExpiredError for an expired approval, and does not resolve it', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', {});
    await client.query('UPDATE pending_approvals SET expires_at = now() - interval \'1 hour\' WHERE id = $1', [
      created.pendingApprovalId,
    ]);

    await assert.rejects(
      () => engine.approve(workspaceId, created.pendingApprovalId!),
      PendingApprovalExpiredError,
    );

    const row = await client.query('SELECT status FROM pending_approvals WHERE id = $1', [created.pendingApprovalId]);
    assert.equal(row.rows[0].status, 'pending');
  });
});

test('list returns all approvals for a workspace, newest first, isolated from other workspaces', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const first = await engine.evaluate(a.workspaceId, 'send_email', { to: 'first@example.com' });
    const second = await engine.evaluate(a.workspaceId, 'send_email', { to: 'second@example.com' });
    await engine.evaluate(b.workspaceId, 'send_email', { to: 'other-workspace@example.com' });

    const approvals = await engine.list(a.workspaceId);
    assert.equal(approvals.length, 2);
    assert.deepEqual(
      approvals.map((approval) => approval.id),
      [second.pendingApprovalId, first.pendingApprovalId],
    );
    assert.ok(approvals.every((approval) => approval.workspaceId === a.workspaceId));
  });
});

test('list filters by effective status, including the derived "expired" state', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const pending = await engine.evaluate(workspaceId, 'send_email', {});
    const approved = await engine.evaluate(workspaceId, 'send_email', {});
    await engine.approve(workspaceId, approved.pendingApprovalId!);
    const expired = await engine.evaluate(workspaceId, 'send_email', {});
    await client.query('UPDATE pending_approvals SET expires_at = now() - interval \'1 hour\' WHERE id = $1', [
      expired.pendingApprovalId,
    ]);

    const pendingOnly = await engine.list(workspaceId, 'pending');
    assert.deepEqual(pendingOnly.map((approval) => approval.id), [pending.pendingApprovalId]);

    const expiredOnly = await engine.list(workspaceId, 'expired');
    assert.deepEqual(expiredOnly.map((approval) => approval.id), [expired.pendingApprovalId]);
  });
});

test('get returns the full approval record, including its actionType and payload', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', { to: 'client@example.com' });
    const approval = await engine.get(workspaceId, created.pendingApprovalId!);

    assert.equal(approval.actionType, 'send_email');
    assert.deepEqual(approval.payload, { to: 'client@example.com' });
    assert.equal(approval.status, 'pending');
  });
});

test('get throws PendingApprovalNotFoundError across workspaces (isolation)', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(a.workspaceId, 'send_email', {});

    await assert.rejects(() => engine.get(b.workspaceId, created.pendingApprovalId!), PendingApprovalNotFoundError);
  });
});
