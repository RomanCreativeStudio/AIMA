import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { MockEmbeddingProvider } from '@aima/ai-engine';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import { StubCalendarConnector } from '../integrations/connectors/calendarConnector';
import { StubGitHubConnector } from '../integrations/connectors/githubConnector';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import type { IntegrationConnector } from '../integrations/connectors/types';
import type { IntegrationProvider } from '../integrations/types';
import { MemoryService } from '../memory/memoryService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { TaskService } from '../tasks/taskService';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowService } from '../workflows/workflowService';
import { WorkspaceService } from '../workspaces/workspaceService';
import { PatternDetectionService } from './patternDetectionService';
import { ProactiveIntelligenceService } from './proactiveIntelligenceService';

const TEST_CREDENTIAL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

function buildService(client: Client) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const taskService = new TaskService(client);
  const workspaceService = new WorkspaceService(client);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const workflowRegistry = new WorkflowRegistry();
  const workflowService = new WorkflowService(client, workflowRegistry, {} as Record<WorkflowKey, WorkflowHandler>, approvalEngine);
  const integrationRegistry = new IntegrationRegistry();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: new StubGmailConnector(),
    github: new StubGitHubConnector(),
    calendar: new StubCalendarConnector(),
  };
  const integrationService = new IntegrationService(
    client,
    integrationRegistry,
    connectors,
    new AesGcmCredentialEncryptor(TEST_CREDENTIAL_ENCRYPTION_KEY),
  );
  const patternDetectionService = new PatternDetectionService(
    workspaceService,
    taskService,
    workflowService,
    approvalEngine,
    actionLogger,
    memoryService,
  );
  const service = new ProactiveIntelligenceService(patternDetectionService, memoryService, integrationService, integrationRegistry);

  return { service, taskService, approvalEngine, workflowService, memoryService, integrationService, permissionEngine };
}

test('getSuggestions rejects an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    const { service } = buildService(client);
    await assert.rejects(service.getSuggestions('00000000-0000-0000-0000-000000000000'), WorkspaceNotFoundError);
  });
});

test('getSuggestions produces a workflow suggestion from a frequent_workflow pattern', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, workflowService } = buildService(client);

    await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    const suggestions = await service.getSuggestions(workspaceId);
    const workflowSuggestion = suggestions.find((s) => s.type === 'workflow');

    assert.ok(workflowSuggestion);
    assert.equal(workflowSuggestion.source, 'frequent_workflow_pattern');
    assert.equal(workflowSuggestion.payload.workflowKey, 'daily_workspace_briefing');
    assert.ok(workflowSuggestion.confidence > 0 && workflowSuggestion.confidence <= 1);
    assert.ok(workflowSuggestion.explanation.length > 0);
    assert.ok(workflowSuggestion.timestamp);
  });
});

test('getSuggestions produces an execution suggestion from a recurring_approval pattern', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, approvalEngine } = buildService(client);

    await approvalEngine.evaluate(workspaceId, 'send_email', { to: 'a@example.com' });
    await approvalEngine.evaluate(workspaceId, 'send_email', { to: 'b@example.com' });

    const suggestions = await service.getSuggestions(workspaceId);
    const executionSuggestion = suggestions.find((s) => s.type === 'execution');

    assert.ok(executionSuggestion);
    assert.equal(executionSuggestion.source, 'recurring_approval_pattern');
    assert.equal(executionSuggestion.payload.actionType, 'send_email');
  });
});

test('getSuggestions produces a task suggestion from a repeated_task pattern', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    await taskService.createTask({ workspaceId, title: 'Draft the Acme proposal' });
    await taskService.createTask({ workspaceId, title: 'Call the Acme team' });

    const suggestions = await service.getSuggestions(workspaceId);
    const taskSuggestion = suggestions.find((s) => s.source === 'repeated_task_pattern');

    assert.ok(taskSuggestion);
    assert.equal(taskSuggestion.type, 'task');
    assert.equal(taskSuggestion.payload.keyword, 'acme');
  });
});

test('getSuggestions produces a task suggestion for missed deadlines', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Overdue task', dueDate: yesterday });

    const suggestions = await service.getSuggestions(workspaceId);
    const missedDeadlineSuggestion = suggestions.find((s) => s.source === 'missed_deadline_pattern');

    assert.ok(missedDeadlineSuggestion);
    assert.equal(missedDeadlineSuggestion.type, 'task');
  });
});

test('getSuggestions produces a memory suggestion when a stored memory closely matches a repeated task keyword', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService, memoryService } = buildService(client);

    await memoryService.createMemory({ workspaceId, scope: 'workspace', content: 'zephyr' });
    await taskService.createTask({ workspaceId, title: 'Draft the zephyr proposal' });
    await taskService.createTask({ workspaceId, title: 'Call about zephyr' });

    const suggestions = await service.getSuggestions(workspaceId);
    const memorySuggestion = suggestions.find((s) => s.type === 'memory');

    assert.ok(memorySuggestion);
    assert.equal(memorySuggestion.source, 'repeated_task_memory_match');
    assert.ok(memorySuggestion.payload.memoryId);
  });
});

test('getSuggestions recommends connecting every unconnected integration, and stops once one is connected', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, integrationService } = buildService(client);

    const suggestionsBefore = await service.getSuggestions(workspaceId);
    const integrationSuggestionsBefore = suggestionsBefore.filter((s) => s.type === 'integration');
    assert.equal(integrationSuggestionsBefore.length, 3);
    assert.ok(integrationSuggestionsBefore.every((s) => s.source === 'integration_not_connected'));

    await integrationService.connect({
      workspaceId,
      provider: 'github',
      credentials: { accessToken: 'token' },
    });

    const suggestionsAfter = await service.getSuggestions(workspaceId);
    const integrationSuggestionsAfter = suggestionsAfter.filter((s) => s.type === 'integration');
    assert.equal(integrationSuggestionsAfter.length, 2);
    assert.ok(!integrationSuggestionsAfter.some((s) => s.payload.provider === 'github'));
  });
});

test('getSuggestions ranks results by confidence, highest first', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, workflowService } = buildService(client);

    for (let i = 0; i < 5; i += 1) {
      await workflowService.createRun({ workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    }

    const suggestions = await service.getSuggestions(workspaceId);

    for (let i = 1; i < suggestions.length; i += 1) {
      assert.ok(suggestions[i - 1].confidence >= suggestions[i].confidence);
    }
  });
});

test('detectPatterns delegates to the pattern detection service', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { service, taskService } = buildService(client);

    await taskService.createTask({ workspaceId, title: 'Draft the Acme proposal' });
    await taskService.createTask({ workspaceId, title: 'Call the Acme team' });

    const patterns = await service.detectPatterns(workspaceId);
    assert.ok(patterns.some((p) => p.type === 'repeated_task'));
  });
});

test('getSuggestions isolates suggestions per workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { service, workflowService } = buildService(client);

    await workflowService.createRun({ workspaceId: a.workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });
    await workflowService.createRun({ workspaceId: a.workspaceId, workflowKey: 'daily_workspace_briefing', input: {} });

    const suggestionsA = await service.getSuggestions(a.workspaceId);
    const suggestionsB = await service.getSuggestions(b.workspaceId);

    assert.ok(suggestionsA.some((s) => s.source === 'frequent_workflow_pattern'));
    assert.ok(!suggestionsB.some((s) => s.source === 'frequent_workflow_pattern'));
    assert.ok(suggestionsA.every((s) => s.workspaceId === a.workspaceId));
  });
});
