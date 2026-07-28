import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../../testUtils/db';
import { ApprovalEngine } from '../../approval/approvalEngine';
import { DraftService } from '../../drafts/draftService';
import { HealthService } from '../../health/healthService';
import { AesGcmCredentialEncryptor } from '../../integrations/encryption';
import { IntegrationService } from '../../integrations/integrationService';
import { IntegrationRegistry } from '../../integrations/registry';
import { StubGmailConnector } from '../../integrations/connectors/gmailConnector';
import { CapabilityRegistry } from '../../permissions/registry';
import { PermissionEngine } from '../../permissions/engine';
import { TaskService } from '../../tasks/taskService';
import { WorkflowRegistry } from '../registry';
import { CreateGithubIssueDraftWorkflowHandler } from './createGithubIssueDraftWorkflow';
import { DailyWorkspaceBriefingWorkflowHandler } from './dailyWorkspaceBriefingWorkflow';
import { DraftEmailReplyWorkflowHandler } from './draftEmailReplyWorkflow';
import { SummarizeUnreadEmailWorkflowHandler } from './summarizeUnreadEmailWorkflow';

const TEST_KEY = randomBytes(32).toString('base64');

/** Deterministic, no-network — mirrors ai-engine's own MockProvider, but echoes the prompt so assertions can check it flowed through. */
class FakeAIProvider implements AIProvider {
  readonly name = 'fake';
  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const lastMessage = request.messages[request.messages.length - 1];
    return {
      content: `[fake] ${lastMessage?.content ?? ''}`,
      model: 'fake-1',
      provider: this.name,
      stopReason: 'end_turn',
    };
  }
}

const registry = new WorkflowRegistry();

test('DraftEmailReplyWorkflowHandler composes then saves an email draft', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const draftService = new DraftService(client);
    const handler = new DraftEmailReplyWorkflowHandler(registry.get('draft_email_reply')!, new FakeAIProvider(), draftService);

    const composed = await handler.executeStep(0, {
      workspaceId,
      input: { topic: 'the deadline', recipientName: 'Sarah' },
      priorOutputs: {},
    });
    assert.equal(composed.subject, 'Re: the deadline');
    assert.match(composed.body as string, /Sarah/);

    const saved = await handler.executeStep(1, {
      workspaceId,
      input: { topic: 'the deadline', recipientName: 'Sarah' },
      priorOutputs: { compose_reply: composed },
    });
    assert.ok(typeof saved.draftId === 'string');

    const draft = await draftService.getDraft(workspaceId, saved.draftId as string);
    assert.equal(draft.type, 'email');
    assert.equal(draft.title, 'Re: the deadline');
  });
});

test('CreateGithubIssueDraftWorkflowHandler composes then saves a github_issue draft', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const draftService = new DraftService(client);
    const handler = new CreateGithubIssueDraftWorkflowHandler(
      registry.get('create_github_issue_draft')!,
      new FakeAIProvider(),
      draftService,
    );

    const composed = await handler.executeStep(0, {
      workspaceId,
      input: { repository: 'AIMA/backend', summary: 'flaky test' },
      priorOutputs: {},
    });
    assert.equal(composed.repository, 'AIMA/backend');

    const saved = await handler.executeStep(1, {
      workspaceId,
      input: {},
      priorOutputs: { compose_issue: composed },
    });

    const draft = await draftService.getDraft(workspaceId, saved.draftId as string);
    assert.equal(draft.type, 'github_issue');
    assert.deepEqual(draft.metadata, { repository: 'AIMA/backend' });
  });
});

test('SummarizeUnreadEmailWorkflowHandler reads via a connected Gmail integration then summarizes', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const integrationRegistry = new IntegrationRegistry();
    const gmailConnector = new StubGmailConnector();
    const integrationService = new IntegrationService(
      client,
      integrationRegistry,
      { gmail: gmailConnector, github: gmailConnector, calendar: gmailConnector },
      new AesGcmCredentialEncryptor(TEST_KEY),
    );
    await integrationService.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } });

    const handler = new SummarizeUnreadEmailWorkflowHandler(
      registry.get('summarize_unread_email')!,
      new FakeAIProvider(),
      integrationService,
      gmailConnector,
    );

    const read = await handler.executeStep(0, { workspaceId, input: { limit: '1' }, priorOutputs: {} });
    const messages = read.messages as unknown[];
    assert.equal(messages.length, 1);

    const summarized = await handler.executeStep(1, { workspaceId, input: {}, priorOutputs: { read_unread_email: read } });
    assert.equal(summarized.messageCount, 1);
    assert.ok(typeof summarized.summary === 'string' && (summarized.summary as string).length > 0);
  });
});

test('SummarizeUnreadEmailWorkflowHandler fails cleanly when Gmail is not connected', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const integrationRegistry = new IntegrationRegistry();
    const gmailConnector = new StubGmailConnector();
    const integrationService = new IntegrationService(
      client,
      integrationRegistry,
      { gmail: gmailConnector, github: gmailConnector, calendar: gmailConnector },
      new AesGcmCredentialEncryptor(TEST_KEY),
    );
    const handler = new SummarizeUnreadEmailWorkflowHandler(
      registry.get('summarize_unread_email')!,
      new FakeAIProvider(),
      integrationService,
      gmailConnector,
    );

    await assert.rejects(() => handler.executeStep(0, { workspaceId, input: {}, priorOutputs: {} }));
  });
});

test('DailyWorkspaceBriefingWorkflowHandler gathers a snapshot then composes a briefing', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const capabilityRegistry = new CapabilityRegistry();
    const permissionEngine = new PermissionEngine(capabilityRegistry);
    const taskService = new TaskService(client);
    const approvalEngine = new ApprovalEngine(client, permissionEngine);
    const healthService = new HealthService(client, new FakeAIProvider());
    await taskService.createTask({ workspaceId, title: 'Ship it' });

    const handler = new DailyWorkspaceBriefingWorkflowHandler(
      registry.get('daily_workspace_briefing')!,
      new FakeAIProvider(),
      taskService,
      approvalEngine,
      healthService,
    );

    const snapshot = await handler.executeStep(0, { workspaceId, input: {}, priorOutputs: {} });
    assert.equal(snapshot.openTaskCount, 1);
    assert.equal(snapshot.pendingApprovalCount, 0);

    const briefing = await handler.executeStep(1, { workspaceId, input: {}, priorOutputs: { gather_snapshot: snapshot } });
    assert.ok(typeof briefing.briefing === 'string' && (briefing.briefing as string).length > 0);
  });
});
