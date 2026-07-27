import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { ApprovalEngine } from './approvalEngine';
import { PendingApprovalAlreadyResolvedError, PendingApprovalNotFoundError, UnregisteredCapabilityError } from './errors';

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
    assert.equal(decision.state, 'approval_required');
    assert.ok(decision.pendingApprovalId);

    const row = await client.query(
      "SELECT status, workspace_id FROM pending_approvals WHERE id = $1",
      [decision.pendingApprovalId],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].status, 'pending');
    assert.equal(row.rows[0].workspace_id, workspaceId);
  });
});

test('evaluate throws for a capability that has not been synced to the database', async () => {
  await withTestTransaction(async (client) => {
    // Deliberately skip seedCapabilities().
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    await assert.rejects(() => engine.evaluate(workspaceId, 'send_email', {}), UnregisteredCapabilityError);
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

test('deny transitions a pending approval to denied', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const engine = new ApprovalEngine(client, new PermissionEngine(new CapabilityRegistry()));

    const created = await engine.evaluate(workspaceId, 'send_email', {});
    const denied = await engine.deny(workspaceId, created.pendingApprovalId!);

    assert.equal(denied.state, 'denied');
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
    assert.equal(status.state, 'approval_required');
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
