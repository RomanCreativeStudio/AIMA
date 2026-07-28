import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import type { IntegrationProvider } from '../integrations/types';
import type { IntegrationConnector } from '../integrations/connectors/types';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from './types';
import { ExecutionApprovalNotYetGrantedError, ExecutionNotFoundError, ExecutorNotFoundError } from './errors';
import { IntegrationNotFoundError } from '../integrations/errors';
import { ExecutionRegistry } from './registry';
import { ExecutionService } from './executionService';
import { GmailSendEmailExecutor } from './executors/gmailSendEmailExecutor';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

/** Counts invocations so idempotent-retry tests can prove the provider was never re-contacted. */
class CountingExecutor implements ActionExecutor {
  readonly actionType = 'send_email';
  readonly provider = 'gmail' as const;
  callCount = 0;

  constructor(private readonly shouldFail = false) {}

  async execute(_context: ExecutorContext): Promise<ExecutionOutcome> {
    this.callCount += 1;
    if (this.shouldFail) {
      throw new Error('provider rejected the request');
    }
    return { responseSummary: { messageId: `msg-${this.callCount}` } };
  }
}

function buildService(client: Client, executor: ActionExecutor = new GmailSendEmailExecutor(new StubGmailConnector())) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const integrationRegistry = new IntegrationRegistry();
  const gmailConnector = new StubGmailConnector();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: gmailConnector,
    github: gmailConnector,
    calendar: gmailConnector,
  };
  const integrationService = new IntegrationService(client, integrationRegistry, connectors, new AesGcmCredentialEncryptor(TEST_KEY));
  const executionRegistry = new ExecutionRegistry([executor]);
  const executionService = new ExecutionService(client, executionRegistry, integrationService, approvalEngine, permissionEngine);

  return { executionService, integrationService, approvalEngine };
}

async function connectGmail(integrationService: IntegrationService, workspaceId: string): Promise<void> {
  await integrationService.connect({
    workspaceId,
    provider: 'gmail',
    credentials: { accessToken: 'a', refreshToken: 'b' },
  });
}

test('preview reports tier, approval requirement, and integration connection status without persisting anything', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { executionService, integrationService } = buildService(client);

    const beforeConnect = await executionService.preview(workspaceId, 'send_email', { to: 'a@b.com' });
    assert.equal(beforeConnect.requiresApproval, true);
    assert.equal(beforeConnect.integrationConnected, false);

    await connectGmail(integrationService, workspaceId);
    const afterConnect = await executionService.preview(workspaceId, 'send_email', { to: 'a@b.com' });
    assert.equal(afterConnect.integrationConnected, true);

    const history = await executionService.listHistory(workspaceId);
    assert.deepEqual(history, [], 'preview must never persist an execution');
  });
});

test('preview rejects an unregistered actionType', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { executionService } = buildService(client);

    await assert.rejects(executionService.preview(workspaceId, 'unknown_action', {}), ExecutorNotFoundError);
  });
});

test('createExecutionRequest rejects before creating any approval when the integration is not connected', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { executionService, approvalEngine } = buildService(client);

    await assert.rejects(
      executionService.createExecutionRequest({ workspaceId, actionType: 'send_email', payload: { to: 'a@b.com' } }),
      IntegrationNotFoundError,
    );

    const approvals = await approvalEngine.list(workspaceId);
    assert.deepEqual(approvals, [], 'no approval should ever be created for an unauthorized request');
  });
});

test('createExecutionRequest creates an awaiting_approval record for a Tier 3 action once connected', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { executionService, integrationService } = buildService(client);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });

    assert.equal(execution.status, 'awaiting_approval');
    assert.equal(execution.provider, 'gmail');
    assert.ok(execution.pendingApprovalId);
    assert.equal(execution.startedAt, null);
    assert.equal(execution.completedAt, null);
  });
});

test('execute throws while the approval is still pending, without contacting the provider', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const executor = new CountingExecutor();
    const { executionService, integrationService } = buildService(client, executor);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });

    await assert.rejects(executionService.execute(workspaceId, execution.id), ExecutionApprovalNotYetGrantedError);
    assert.equal(executor.callCount, 0);
  });
});

test('execute succeeds once the approval is granted, recording the response summary and timestamps', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const executor = new CountingExecutor();
    const { executionService, integrationService, approvalEngine } = buildService(client, executor);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });
    await approvalEngine.approve(workspaceId, execution.pendingApprovalId!);

    const succeeded = await executionService.execute(workspaceId, execution.id);

    assert.equal(succeeded.status, 'succeeded');
    assert.equal(succeeded.responseSummary?.messageId, 'msg-1');
    assert.equal(executor.callCount, 1);
    assert.ok(succeeded.startedAt);
    assert.ok(succeeded.completedAt);
  });
});

test('execute is idempotent: calling it again after success never re-contacts the provider', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const executor = new CountingExecutor();
    const { executionService, integrationService, approvalEngine } = buildService(client, executor);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });
    await approvalEngine.approve(workspaceId, execution.pendingApprovalId!);
    const first = await executionService.execute(workspaceId, execution.id);

    const retried = await executionService.execute(workspaceId, execution.id);

    assert.equal(executor.callCount, 1, 'a retry after success must not invoke the executor again');
    assert.equal(retried.status, 'succeeded');
    assert.deepEqual(retried.responseSummary, first.responseSummary);
  });
});

test('execute marks the execution failed when the approval was rejected, without contacting the provider', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const executor = new CountingExecutor();
    const { executionService, integrationService, approvalEngine } = buildService(client, executor);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });
    await approvalEngine.reject(workspaceId, execution.pendingApprovalId!);

    const failed = await executionService.execute(workspaceId, execution.id);

    assert.equal(failed.status, 'failed');
    assert.match(failed.errorDetails ?? '', /rejected/);
    assert.equal(executor.callCount, 0);

    const retried = await executionService.execute(workspaceId, execution.id);
    assert.equal(retried.status, 'failed', 'idempotent: still failed, no further attempt');
  });
});

test('execute marks the execution failed when the executor itself throws (provider failure)', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const executor = new CountingExecutor(true);
    const { executionService, integrationService, approvalEngine } = buildService(client, executor);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });
    await approvalEngine.approve(workspaceId, execution.pendingApprovalId!);

    const failed = await executionService.execute(workspaceId, execution.id);

    assert.equal(failed.status, 'failed');
    assert.match(failed.errorDetails ?? '', /provider rejected the request/);
    assert.equal(executor.callCount, 1);
  });
});

test('execute fails cleanly if the integration was disconnected after approval but before running', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const executor = new CountingExecutor();
    const { executionService, integrationService, approvalEngine } = buildService(client, executor);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });
    await approvalEngine.approve(workspaceId, execution.pendingApprovalId!);
    await integrationService.disconnect(workspaceId, 'gmail');

    const failed = await executionService.execute(workspaceId, execution.id);

    assert.equal(failed.status, 'failed');
    assert.match(failed.errorDetails ?? '', /Integration not connected/);
    assert.equal(executor.callCount, 0);
  });
});

test('getExecution and execute enforce workspace isolation', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: otherWorkspaceId } = await seedWorkspace(client, 'mfs');
    const { executionService, integrationService } = buildService(client);
    await connectGmail(integrationService, workspaceId);

    const execution = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'client@example.com', subject: 'Hi', body: 'Hello' },
    });

    await assert.rejects(executionService.getExecution(otherWorkspaceId, execution.id), ExecutionNotFoundError);
    await assert.rejects(executionService.execute(otherWorkspaceId, execution.id), ExecutionNotFoundError);

    const otherHistory = await executionService.listHistory(otherWorkspaceId);
    assert.deepEqual(otherHistory, []);
  });
});

test('listHistory returns newest first', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { executionService, integrationService } = buildService(client);
    await connectGmail(integrationService, workspaceId);

    const first = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'a@b.com', subject: 's1', body: 'b1' },
    });
    const second = await executionService.createExecutionRequest({
      workspaceId,
      actionType: 'send_email',
      payload: { to: 'a@b.com', subject: 's2', body: 'b2' },
    });

    const history = await executionService.listHistory(workspaceId);
    assert.deepEqual(history.map((execution) => execution.id), [second.id, first.id]);
  });
});

test('createExecutionRequest rejects an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { executionService } = buildService(client);
    await assert.rejects(
      executionService.createExecutionRequest({
        workspaceId: '00000000-0000-0000-0000-000000000000',
        actionType: 'send_email',
        payload: {},
      }),
      WorkspaceNotFoundError,
    );
  });
});
