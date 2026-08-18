import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { MockEmbeddingProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { seedCapabilities, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ApprovalEngine } from '../approval/approvalEngine';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PreferenceService } from '../preferences/preferenceService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { WorkspaceService } from '../workspaces/workspaceService';
import { AimaCoreService } from './aimaCoreService';
import { ContextManager } from './contextManager';

/** Records the last request it received instead of calling a real provider — a spy, not a stub. */
class RecordingAIProvider implements AIProvider {
  readonly name = 'recording';
  lastRequest?: AICompletionRequest;

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    this.lastRequest = request;
    return { content: 'a response', model: 'recording-1', provider: this.name, stopReason: 'end_turn' };
  }
}

function buildCoreService(client: Client, registry: CapabilityRegistry = new CapabilityRegistry()) {
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const documentService = new DocumentService(client, new MockEmbeddingProvider());
  const preferenceService = new PreferenceService(client);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const permissionEngine = new PermissionEngine(registry);
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const workspaceService = new WorkspaceService(client);
  const provider = new RecordingAIProvider();
  const core = new AimaCoreService(contextManager, provider, intentEngine, approvalEngine, workspaceService);
  return { core, provider, memoryService, documentService, preferenceService, workspaceService };
}

test('handleRequest returns AI content, context, and intent together', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { core } = buildCoreService(client);

    const response = await core.handleRequest({
      workspaceId,
      workspaceSlug: 'rcs',
      query: 'What should I tell the client?',
      history: [],
    });

    assert.equal(response.content, 'a response');
    assert.equal(response.provider, 'recording');
    assert.equal(response.context.workspaceSlug, 'rcs');
    assert.ok(response.intent.intent);
    assert.equal(response.approvalDecision.state, 'no_approval_needed');
  });
});

test('handleRequest creates a real pending approval when the detected intent maps to a Tier 3 capability', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const registry = new CapabilityRegistry([
      { actionType: 'create_task', defaultTier: 'execute_with_approval', tierLocked: false, description: '' },
    ]);
    const { core } = buildCoreService(client, registry);

    const response = await core.handleRequest({
      workspaceId,
      workspaceSlug: 'rcs',
      query: 'Remind me to follow up with Acme on Friday.',
      history: [],
    });

    assert.equal(response.intent.intent, 'create_task');
    assert.equal(response.approvalDecision.state, 'pending');
    assert.ok(response.approvalDecision.pendingApprovalId);

    const row = await client.query('SELECT status FROM pending_approvals WHERE id = $1', [
      response.approvalDecision.pendingApprovalId,
    ]);
    assert.equal(row.rows[0].status, 'pending');
  });
});

test('handleRequest uses the workspace-specific assistant profile in the system prompt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId: rcsId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: mfsId } = await seedWorkspace(client, 'mfs');
    const { core, provider } = buildCoreService(client);

    await core.handleRequest({ workspaceId: rcsId, workspaceSlug: 'rcs', query: 'hello', history: [] });
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Roman Creative Studio/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /needs approval before it is ever sent/);

    await core.handleRequest({ workspaceId: mfsId, workspaceSlug: 'mfs', query: 'hello', history: [] });
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Mythic Forge Studios/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /narrative and character consistency/);
  });
});

test('handleRequest includes a workspace\'s own DB-backed instructions and assistantBehavior in the system prompt (Phase 1.8)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { core, provider, workspaceService } = buildCoreService(client);

    await workspaceService.updateWorkspace(workspaceId, {
      instructions: 'Always mention the Acme contract deadline.',
      assistantBehavior: { tone: 'formal' },
    });

    await core.handleRequest({ workspaceId, workspaceSlug: 'rcs', query: 'hello', history: [] });

    // The static per-slug default is still present alongside the override.
    assert.match(provider.lastRequest!.systemPrompt ?? '', /needs approval before it is ever sent/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Always mention the Acme contract deadline\./);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /tone: formal/);
  });
});

test('handleRequest surfaces the same workspace\'s config differently across two switches (workspace switching)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId: rcsId } = await seedWorkspace(client, 'rcs');
    const { workspaceId: mfsId } = await seedWorkspace(client, 'mfs');
    const { core, provider, workspaceService } = buildCoreService(client);

    await workspaceService.updateWorkspace(rcsId, { instructions: 'RCS-only guidance.' });
    await workspaceService.updateWorkspace(mfsId, { instructions: 'MFS-only guidance.' });

    await core.handleRequest({ workspaceId: rcsId, workspaceSlug: 'rcs', query: 'hello', history: [] });
    assert.match(provider.lastRequest!.systemPrompt ?? '', /RCS-only guidance\./);
    assert.doesNotMatch(provider.lastRequest!.systemPrompt ?? '', /MFS-only guidance\./);

    await core.handleRequest({ workspaceId: mfsId, workspaceSlug: 'mfs', query: 'hello', history: [] });
    assert.match(provider.lastRequest!.systemPrompt ?? '', /MFS-only guidance\./);
    assert.doesNotMatch(provider.lastRequest!.systemPrompt ?? '', /RCS-only guidance\./);
  });
});

test('handleRequest includes workspace preferences in the system prompt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const { core, provider, preferenceService } = buildCoreService(client);

    await preferenceService.setPreference({
      workspaceId,
      category: 'response_preferences',
      key: 'verbosity',
      value: 'concise',
    });

    await core.handleRequest({ workspaceId, workspaceSlug: 'development', query: 'hello', history: [] });

    assert.match(provider.lastRequest!.systemPrompt ?? '', /Workspace preferences to follow/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /\[response_preferences\] verbosity: concise/);
  });
});

test('handleRequest gathers memory and document context into the system prompt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'mfs');
    const { core, provider, memoryService, documentService } = buildCoreService(client);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Kestrel is the protagonist of the Fracture Protocol.',
    });
    await documentService.importDocument({
      workspaceId,
      format: 'plaintext',
      content: 'Character sheet: Kestrel wields a fractured blade.',
    });

    await core.handleRequest({ workspaceId, workspaceSlug: 'mfs', query: 'Tell me about Kestrel', history: [] });

    assert.match(provider.lastRequest!.systemPrompt ?? '', /Kestrel is the protagonist/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /fractured blade/);
  });
});

test('handleRequest applies configurable context limits', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const { core, memoryService } = buildCoreService(client);

    for (let i = 0; i < 5; i++) {
      await memoryService.createMemory({ workspaceId, scope: 'workspace', content: `fact ${i} about planning` });
    }

    const response = await core.handleRequest({
      workspaceId,
      workspaceSlug: 'personal',
      query: 'planning facts',
      history: [],
      limits: { memoryLimit: 2 },
    });

    assert.ok(response.context.memories.length <= 2);
  });
});

test('handleRequest propagates AI provider failures rather than swallowing them', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const documentService = new DocumentService(client, new MockEmbeddingProvider());
    const preferenceService = new PreferenceService(client);
    const contextManager = new ContextManager(memoryService, documentService, preferenceService);
    const permissionEngine = new PermissionEngine(new CapabilityRegistry());
    const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
    const approvalEngine = new ApprovalEngine(client, permissionEngine);
    const workspaceService = new WorkspaceService(client);

    const failingProvider: AIProvider = {
      name: 'failing',
      complete: async () => {
        throw new Error('provider unavailable');
      },
    };

    const core = new AimaCoreService(contextManager, failingProvider, intentEngine, approvalEngine, workspaceService);

    await assert.rejects(
      () => core.handleRequest({ workspaceId, workspaceSlug: 'development', query: 'hi', history: [] }),
      /provider unavailable/,
    );
  });
});
