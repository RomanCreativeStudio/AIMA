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
import { PatternDetectionService } from '../proactive/patternDetectionService';
import { ProactiveIntelligenceService } from '../proactive/proactiveIntelligenceService';
import { TaskService } from '../tasks/taskService';
import type { WorkflowHandler } from '../workflows/handlers/types';
import { WorkflowRegistry } from '../workflows/registry';
import type { WorkflowKey } from '../workflows/types';
import { WorkflowService } from '../workflows/workflowService';
import { WorkspaceService } from '../workspaces/workspaceService';
import { BriefingService } from './briefingService';
import { WorkspaceDigestService } from './workspaceDigestService';

const TEST_CREDENTIAL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

/** The full stack `WorkspaceDigestService` needs — same collaborators `proactiveIntelligenceService.test.ts`/`briefingService.test.ts` already assemble, just also wired into a `WorkspaceDigestService`. */
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
  const proactiveIntelligenceService = new ProactiveIntelligenceService(
    patternDetectionService,
    memoryService,
    integrationService,
    integrationRegistry,
    workspaceService,
    actionLogger,
  );
  const briefingService = new BriefingService(
    workspaceService,
    taskService,
    approvalEngine,
    workflowService,
    actionLogger,
    memoryService,
    proactiveIntelligenceService,
    integrationService,
  );
  const digestService = new WorkspaceDigestService(workspaceService, briefingService);

  return { digestService, workspaceService, taskService, approvalEngine };
}

test('getDigest returns an empty list for a user with no workspaces', async () => {
  await withTestTransaction(async (client) => {
    const { digestService } = buildService(client);

    const digest = await digestService.getDigest('00000000-0000-0000-0000-000000000000');

    assert.deepEqual(digest, []);
  });
});

test('getDigest returns one row per workspace the user owns, with zeroed counts for a brand-new workspace', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const { digestService } = buildService(client);

    const digest = await digestService.getDigest(userId);

    assert.equal(digest.length, 1);
    assert.equal(digest[0].workspaceId, workspaceId);
    assert.equal(digest[0].workspaceName, 'rcs');
    assert.equal(digest[0].nudgeCount, 0, 'no nudge-pattern suggestions for a workspace with no tasks/decisions');
    // topSuggestion is non-null here — a brand-new workspace has three unconnected integrations, each producing
    // a "Connect X" suggestion (see proactiveIntelligenceService.test.ts), so suggestedNextActions is never empty.
    assert.equal(digest[0].pendingApprovalCount, 0);
    assert.equal(digest[0].overdueTaskCount, 0);
    assert.equal(digest[0].blockedItemCount, 0);
    assert.ok(digest[0].greeting.length > 0);
  });
});

test('getDigest returns a row per workspace when the caller owns more than one', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'rcs');
    const { digestService, workspaceService } = buildService(client);
    await workspaceService.createWorkspace({ userId, slug: 'personal', name: 'personal' });

    const digest = await digestService.getDigest(userId);

    assert.equal(digest.length, 2);
    assert.deepEqual(
      digest.map((d) => d.workspaceName).sort(),
      ['personal', 'rcs'],
    );
  });
});

test('getDigest reports correct per-workspace counts: overdue tasks, blocked tasks, and pending approvals', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const { digestService, taskService, approvalEngine } = buildService(client);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Overdue task', dueDate: yesterday });
    const blocked = await taskService.createTask({ workspaceId, title: 'Blocked task' });
    await taskService.updateTask(workspaceId, blocked.id, { metadata: { category: 'blocked' } });
    await seedCapabilities(client);
    await approvalEngine.evaluate(workspaceId, 'send_email', { to: 'a@example.com' });

    const digest = await digestService.getDigest(userId);

    assert.equal(digest.length, 1);
    assert.equal(digest[0].overdueTaskCount, 1);
    assert.equal(digest[0].blockedItemCount, 1);
    assert.equal(digest[0].pendingApprovalCount, 1);
  });
});

test('getDigest surfaces a nudge count and top suggestion once a nudge-triggering pattern exists', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const { digestService, taskService } = buildService(client);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await taskService.createTask({ workspaceId, title: 'Overdue task', dueDate: yesterday });

    const digest = await digestService.getDigest(userId);

    assert.equal(digest.length, 1);
    assert.equal(digest[0].nudgeCount, 1);
    assert.ok(digest[0].topSuggestion);
    assert.equal(digest[0].topSuggestion?.source, 'missed_deadline_pattern');
  });
});

test('getDigest isolates workspaces per user', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const { digestService } = buildService(client);

    const digestA = await digestService.getDigest(a.userId);
    const digestB = await digestService.getDigest(b.userId);

    assert.equal(digestA.length, 1);
    assert.equal(digestA[0].workspaceId, a.workspaceId);
    assert.equal(digestB.length, 1);
    assert.equal(digestB[0].workspaceId, b.workspaceId);
    assert.notEqual(digestA[0].workspaceId, digestB[0].workspaceId);
  });
});
