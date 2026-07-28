import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { MockEmbeddingProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AimaCoreService } from '../core/aimaCoreService';
import { ContextManager } from '../core/contextManager';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { PreferenceService } from '../preferences/preferenceService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { WorkspaceService } from '../workspaces/workspaceService';
import { WorkflowRegistry } from '../workflows/registry';
import { WorkflowIntentMatcher } from '../workflows/workflowIntentMatcher';
import { ExecutionIntentMatcher } from '../execution/executionIntentMatcher';
import { ExecutionRegistry } from '../execution/registry';
import { ConversationService } from '../conversation/conversationService';
import { ConversationNotFoundError } from '../conversation/errors';
import { ConversationIntelligenceService } from './conversationIntelligenceService';

/** Returns a different, deterministic response depending on which of the two prompts (summary vs. follow-ups) it's asked. */
class ScriptedAIProvider implements AIProvider {
  readonly name = 'scripted';

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const prompt = request.messages[request.messages.length - 1]?.content ?? '';
    const content = prompt.startsWith('Summarize')
      ? 'The user discussed the Acme project timeline.'
      : 'Follow up on the Acme timeline\nCheck the contract terms\nSend the invoice\nExtra line that must be truncated';
    return { content, model: 'scripted-1', provider: this.name, stopReason: 'end_turn' };
  }
}

function buildService(client: Client, aiProvider: AIProvider) {
  const capabilityRegistry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(capabilityRegistry);
  const actionLogger = new ActionLogger(client);
  const embeddingProvider = new MockEmbeddingProvider();
  const memoryService = new MemoryService(client, embeddingProvider);
  const documentService = new DocumentService(client, embeddingProvider);
  const preferenceService = new PreferenceService(client);
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const workspaceService = new WorkspaceService(client);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const aimaCoreService = new AimaCoreService(contextManager, aiProvider, intentEngine, approvalEngine, workspaceService);
  const workflowIntentMatcher = new WorkflowIntentMatcher(new WorkflowRegistry());
  const executionIntentMatcher = new ExecutionIntentMatcher(new ExecutionRegistry());

  const conversationService = new ConversationService({
    db: client,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
    executionIntentMatcher,
  });

  const conversationIntelligenceService = new ConversationIntelligenceService(conversationService, memoryService, aiProvider);

  return { conversationService, memoryService, conversationIntelligenceService };
}

test('analyze rejects an unknown conversation', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { conversationIntelligenceService } = buildService(client, new ScriptedAIProvider());

    await assert.rejects(
      conversationIntelligenceService.analyze(workspaceId, '00000000-0000-0000-0000-000000000000'),
      ConversationNotFoundError,
    );
  });
});

test('analyze rejects an unknown workspace/conversation pair identically to a real conversation in the wrong workspace', async () => {
  // ConversationService.listMessages resolves via assertConversationInWorkspace (WHERE conversation_id = $1 AND
  // workspace_id = $2) — it never separately checks workspace existence, so a bogus workspaceId reports
  // ConversationNotFoundError, the same as a real conversation belonging to a different workspace.
  await withTestTransaction(async (client) => {
    const { conversationIntelligenceService } = buildService(client, new ScriptedAIProvider());

    await assert.rejects(
      conversationIntelligenceService.analyze('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001'),
      ConversationNotFoundError,
    );
  });
});

test('analyze returns an empty result with no AI call for a conversation with no messages', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    const { conversationIntelligenceService } = buildService(client, new ScriptedAIProvider());

    const result = await conversationIntelligenceService.analyze(workspaceId, conversationId);

    assert.equal(result.summary, '');
    assert.deepEqual(result.suggestedFollowUps, []);
    assert.deepEqual(result.recentContext, []);
    assert.deepEqual(result.relatedMemories, []);
  });
});

test('analyze produces a summary, up to 3 parsed follow-ups, recent context, and related memories', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    const { conversationService, memoryService, conversationIntelligenceService } = buildService(
      client,
      new ScriptedAIProvider(),
    );

    await conversationService.sendMessage({
      workspaceId,
      conversationId,
      content: 'What should I tell Acme about the project timeline?',
    });
    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Acme project timeline was pushed back two weeks last quarter.',
    });

    const result = await conversationIntelligenceService.analyze(workspaceId, conversationId);

    assert.equal(result.summary, 'The user discussed the Acme project timeline.');
    assert.deepEqual(result.suggestedFollowUps, [
      'Follow up on the Acme timeline',
      'Check the contract terms',
      'Send the invoice',
    ]);
    assert.equal(result.recentContext.length, 2, 'both the user message and the assistant reply');
    assert.equal(result.relatedMemories.length, 1);
    assert.match(result.relatedMemories[0].content, /Acme project timeline/);
  });
});

test('analyze respects a custom contextLimit and relatedMemoryLimit', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    const { conversationService, memoryService, conversationIntelligenceService } = buildService(
      client,
      new ScriptedAIProvider(),
    );

    for (let i = 0; i < 3; i += 1) {
      await conversationService.sendMessage({ workspaceId, conversationId, content: `message ${i}` });
    }
    for (let i = 0; i < 3; i += 1) {
      await memoryService.createMemory({ workspaceId, scope: 'workspace', content: `message related memory ${i}` });
    }

    const result = await conversationIntelligenceService.analyze(workspaceId, conversationId, {
      contextLimit: 2,
      relatedMemoryLimit: 1,
    });

    assert.equal(result.recentContext.length, 2);
    assert.equal(result.relatedMemories.length, 1);
  });
});
