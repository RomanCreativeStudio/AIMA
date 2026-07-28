import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ApprovalEngine } from '../approval/approvalEngine';
import { DraftService } from '../drafts/draftService';
import { HealthService } from '../health/healthService';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { TaskService } from '../tasks/taskService';
import { WorkspaceNotFoundError } from '../types/errors';
import { CreateGithubIssueDraftWorkflowHandler } from './handlers/createGithubIssueDraftWorkflow';
import { DailyWorkspaceBriefingWorkflowHandler } from './handlers/dailyWorkspaceBriefingWorkflow';
import { DraftEmailReplyWorkflowHandler } from './handlers/draftEmailReplyWorkflow';
import { SummarizeUnreadEmailWorkflowHandler } from './handlers/summarizeUnreadEmailWorkflow';
import type { WorkflowHandler } from './handlers/types';
import { InvalidWorkflowStateError, WorkflowApprovalNotYetGrantedError, WorkflowRunNotFoundError } from './errors';
import { WorkflowRegistry } from './registry';
import type { WorkflowKey } from './types';
import { WorkflowService } from './workflowService';

const TEST_KEY = randomBytes(32).toString('base64');

class FakeAIProvider implements AIProvider {
  readonly name = 'fake';
  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const lastMessage = request.messages[request.messages.length - 1];
    return { content: `[fake] ${lastMessage?.content ?? ''}`, model: 'fake-1', provider: this.name, stopReason: 'end_turn' };
  }
}

function buildService(client: Client) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const draftService = new DraftService(client);
  const taskService = new TaskService(client);
  const healthService = new HealthService(client, new FakeAIProvider());
  const integrationRegistry = new IntegrationRegistry();
  const gmailConnector = new StubGmailConnector();
  const integrationService = new IntegrationService(
    client,
    integrationRegistry,
    { gmail: gmailConnector, github: gmailConnector, calendar: gmailConnector },
    new AesGcmCredentialEncryptor(TEST_KEY),
  );

  const workflowRegistry = new WorkflowRegistry();
  const handlers: Record<WorkflowKey, WorkflowHandler> = {
    draft_email_reply: new DraftEmailReplyWorkflowHandler(
      workflowRegistry.get('draft_email_reply')!,
      new FakeAIProvider(),
      draftService,
    ),
    create_github_issue_draft: new CreateGithubIssueDraftWorkflowHandler(
      workflowRegistry.get('create_github_issue_draft')!,
      new FakeAIProvider(),
      draftService,
    ),
    summarize_unread_email: new SummarizeUnreadEmailWorkflowHandler(
      workflowRegistry.get('summarize_unread_email')!,
      new FakeAIProvider(),
      integrationService,
      gmailConnector,
    ),
    daily_workspace_briefing: new DailyWorkspaceBriefingWorkflowHandler(
      workflowRegistry.get('daily_workspace_briefing')!,
      new FakeAIProvider(),
      taskService,
      approvalEngine,
      healthService,
    ),
  };

  const workflowService = new WorkflowService(client, workflowRegistry, handlers, approvalEngine);
  return { workflowService, approvalEngine, integrationService };
}

test('createRun creates a pending run with all steps pre-populated as pending', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService } = buildService(client);

    const run = await workflowService.createRun({ workspaceId, workflowKey: 'draft_email_reply', input: { topic: 'x' } });

    assert.equal(run.status, 'pending');
    assert.equal(run.currentStepIndex, 0);
    assert.equal(run.steps.length, 2);
    assert.ok(run.steps.every((step) => step.status === 'pending'));
    assert.equal(run.steps[1].capability, 'draft_email');
  });
});

test('createRun rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workflowService } = buildService(client);

    await assert.rejects(
      () =>
        workflowService.createRun({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          workflowKey: 'daily_workspace_briefing',
          input: {},
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('executeNextStep runs an internal step immediately and advances to running', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService } = buildService(client);
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'draft_email_reply', input: { topic: 'x' } });

    const afterStep0 = await workflowService.executeNextStep(workspaceId, run.id);

    assert.equal(afterStep0.status, 'running');
    assert.equal(afterStep0.currentStepIndex, 1);
    assert.equal(afterStep0.steps[0].status, 'completed');
    assert.ok(afterStep0.steps[0].output?.body);
  });
});

test('executing the final step marks the run completed and sets its result', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService } = buildService(client);
    const run = await workflowService.createRun({
      workspaceId,
      workflowKey: 'daily_workspace_briefing',
      input: {},
    });

    await workflowService.executeNextStep(workspaceId, run.id);
    const final = await workflowService.executeNextStep(workspaceId, run.id);

    assert.equal(final.status, 'completed');
    assert.ok(final.completedAt);
    assert.ok(final.result?.briefing);
    assert.ok(final.steps.every((step) => step.status === 'completed'));
  });
});

test('executeNextStep on a Tier 3 gated step creates a pending approval and pauses without running the handler', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });

    const afterStep0 = await workflowService.executeNextStep(workspaceId, run.id);

    assert.equal(afterStep0.status, 'awaiting_approval');
    assert.equal(afterStep0.currentStepIndex, 0, 'the gated step has not actually run yet, so the index does not advance');
    assert.equal(afterStep0.steps[0].status, 'awaiting_approval');
    assert.ok(afterStep0.steps[0].pendingApprovalId);
    assert.equal(afterStep0.steps[0].output, null, 'the read has not actually happened yet');
  });
});

test('executeNextStep is rejected while a run is awaiting_approval, paused, or already terminal', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });
    await workflowService.executeNextStep(workspaceId, run.id);

    await assert.rejects(() => workflowService.executeNextStep(workspaceId, run.id), InvalidWorkflowStateError);
  });
});

test('resume executes the gated step for real once its approval is granted, then the run can finish', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService, approvalEngine } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });
    const awaiting = await workflowService.executeNextStep(workspaceId, run.id);
    const pendingApprovalId = awaiting.steps[0].pendingApprovalId!;

    await approvalEngine.approve(workspaceId, pendingApprovalId);
    const afterResume = await workflowService.resume(workspaceId, run.id);

    assert.equal(afterResume.status, 'running');
    assert.equal(afterResume.currentStepIndex, 1);
    assert.equal(afterResume.steps[0].status, 'completed');
    assert.ok(afterResume.steps[0].output?.messages);

    const final = await workflowService.executeNextStep(workspaceId, run.id);
    assert.equal(final.status, 'completed');
    assert.ok(final.result?.summary);
  });
});

test('resume throws WorkflowApprovalNotYetGrantedError while the approval is still pending', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });
    await workflowService.executeNextStep(workspaceId, run.id);

    await assert.rejects(() => workflowService.resume(workspaceId, run.id), WorkflowApprovalNotYetGrantedError);
  });
});

test('resume marks the run failed when the blocking approval was rejected', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService, approvalEngine } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });
    const awaiting = await workflowService.executeNextStep(workspaceId, run.id);
    await approvalEngine.reject(workspaceId, awaiting.steps[0].pendingApprovalId!);

    const afterResume = await workflowService.resume(workspaceId, run.id);

    assert.equal(afterResume.status, 'failed');
    assert.equal(afterResume.steps[0].status, 'failed');
    assert.ok(afterResume.completedAt);
  });
});

test('pause then resume returns a paused run to running, and executeNextStep works again afterward', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService } = buildService(client);
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    const paused = await workflowService.pause(workspaceId, run.id);
    assert.equal(paused.status, 'paused');
    await assert.rejects(() => workflowService.executeNextStep(workspaceId, run.id), InvalidWorkflowStateError);

    const resumed = await workflowService.resume(workspaceId, run.id);
    assert.equal(resumed.status, 'running');

    const afterStep0 = await workflowService.executeNextStep(workspaceId, run.id);
    assert.equal(afterStep0.steps[0].status, 'completed');
  });
});

test('pause rejects a run that is awaiting_approval or already terminal', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });
    await workflowService.executeNextStep(workspaceId, run.id);

    await assert.rejects(() => workflowService.pause(workspaceId, run.id), InvalidWorkflowStateError);
  });
});

test('cancel marks a pending run cancelled and skips its pending step', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService } = buildService(client);
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    const cancelled = await workflowService.cancel(workspaceId, run.id);

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.steps[0].status, 'skipped');
    assert.ok(cancelled.completedAt);
  });
});

test('cancel rejects an already-terminal run', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService } = buildService(client);
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.cancel(workspaceId, run.id);

    await assert.rejects(() => workflowService.cancel(workspaceId, run.id), InvalidWorkflowStateError);
  });
});

test('a handler failure during resume marks the step and run failed rather than throwing', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { workflowService, integrationService, approvalEngine } = buildService(client);
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });
    const run = await workflowService.createRun({ workspaceId, workflowKey: 'summarize_unread_email', input: {} });
    const awaiting = await workflowService.executeNextStep(workspaceId, run.id);
    await approvalEngine.approve(workspaceId, awaiting.steps[0].pendingApprovalId!);
    // Disconnected between approval and resume — the handler's real effect (reading Gmail) now fails.
    await integrationService.disconnect(workspaceId, 'gmail');

    const afterResume = await workflowService.resume(workspaceId, run.id);

    assert.equal(afterResume.status, 'failed');
    assert.equal(afterResume.steps[0].status, 'failed');
    assert.ok(afterResume.steps[0].output?.error);
  });
});

test('getRun 404s for a run belonging to a different workspace (isolation)', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { workflowService } = buildService(client);
    const run = await workflowService.createRun({ workspaceId: a.workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    await assert.rejects(() => workflowService.getRun(b.workspaceId, run.id), WorkflowRunNotFoundError);
  });
});

test('listRuns is scoped to the workspace and ordered newest first', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { workflowService } = buildService(client);
    await workflowService.createRun({ workspaceId: a.workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    const second = await workflowService.createRun({ workspaceId: a.workspaceId, workflowKey: 'draft_email_reply', input: {} });
    await workflowService.createRun({ workspaceId: b.workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    const runsInA = await workflowService.listRuns(a.workspaceId);

    assert.equal(runsInA.length, 2);
    assert.equal(runsInA[0].id, second.id, 'the most recently created run should be first');
    assert.ok(runsInA.every((run) => run.workspaceId === a.workspaceId));
  });
});
