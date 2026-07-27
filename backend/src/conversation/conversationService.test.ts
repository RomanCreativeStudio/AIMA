import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { MockEmbeddingProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { IntentEngine } from '../intent/intentEngine';
import { MemoryService } from '../memory/memoryService';
import { CapabilityRegistry } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { ConversationService } from './conversationService';
import { ConversationNotFoundError, WorkspaceNotFoundError } from './errors';

/** Records the last request it received instead of calling a real provider — a spy, not a stub. */
class RecordingAIProvider implements AIProvider {
  readonly name = 'recording';
  lastRequest?: AICompletionRequest;

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    this.lastRequest = request;
    const lastMessage = request.messages[request.messages.length - 1];
    return {
      content: `echo: ${lastMessage?.content ?? ''}`,
      model: 'recording-1',
      provider: this.name,
      stopReason: 'end_turn',
    };
  }
}

function buildService(client: Client, provider: AIProvider) {
  const registry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  return {
    service: new ConversationService(client, memoryService, provider, actionLogger, permissionEngine, intentEngine),
    memoryService,
  };
}

test('sendMessage runs the full pipeline: saves both messages and logs the generation', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    const provider = new RecordingAIProvider();
    const { service } = buildService(client, provider);

    const result = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'What should I tell the client about the timeline?',
    });

    assert.equal(result.userMessage.role, 'user');
    assert.equal(result.userMessage.content, 'What should I tell the client about the timeline?');
    assert.equal(result.assistantMessage.role, 'assistant');
    assert.match(result.assistantMessage.content, /^echo: /);

    const history = await service.listMessages(workspaceId, conversationId);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');

    const log = await client.query('SELECT summary, outcome, tier FROM action_log WHERE workspace_id = $1', [
      workspaceId,
    ]);
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].outcome, 'success');
    assert.equal(log.rows[0].tier, 'suggest');
  });
});

test('sendMessage retrieves relevant workspace memory and includes it in the system prompt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'mfs');
    const conversationId = await seedConversation(client, workspaceId);
    const provider = new RecordingAIProvider();
    const { service, memoryService } = buildService(client, provider);

    await memoryService.createMemory({
      workspaceId,
      scope: 'workspace',
      content: 'Kestrel is the protagonist of the Fracture Protocol.',
    });

    await service.sendMessage({ workspaceId, conversationId, content: 'Tell me about Kestrel.' });

    assert.ok(provider.lastRequest, 'the AI provider should have been called');
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Kestrel is the protagonist/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Mythic Forge Studios/);
  });
});

test('sendMessage never retrieves memory from a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const conversationId = await seedConversation(client, rcs.workspaceId);
    const provider = new RecordingAIProvider();
    const { service, memoryService } = buildService(client, provider);

    await memoryService.createMemory({
      workspaceId: mfs.workspaceId,
      scope: 'workspace',
      content: 'Kestrel backstory notes that should never leak into RCS.',
    });

    await service.sendMessage({ workspaceId: rcs.workspaceId, conversationId, content: 'Tell me about Kestrel.' });

    assert.ok(provider.lastRequest);
    assert.doesNotMatch(provider.lastRequest!.systemPrompt ?? '', /Kestrel/);
  });
});

test('sendMessage rejects a conversation that belongs to a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const rcsConversationId = await seedConversation(client, rcs.workspaceId);
    const { service } = buildService(client, new RecordingAIProvider());

    await assert.rejects(
      () => service.sendMessage({ workspaceId: mfs.workspaceId, conversationId: rcsConversationId, content: 'hi' }),
      ConversationNotFoundError,
    );
  });
});

test('createConversation rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const { service } = buildService(client, new RecordingAIProvider());
    await assert.rejects(
      () => service.createConversation('00000000-0000-0000-0000-000000000000'),
      WorkspaceNotFoundError,
    );
  });
});

test('listMessages applies the history limit (context limit)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const conversationId = await seedConversation(client, workspaceId);
    const registry = new CapabilityRegistry();
    const permissionEngine = new PermissionEngine(registry);
    const actionLogger = new ActionLogger(client);
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
    const provider = new RecordingAIProvider();
    // historyLimit = 3 for this test
    const service = new ConversationService(
      client,
      memoryService,
      provider,
      actionLogger,
      permissionEngine,
      intentEngine,
      3,
      5,
    );

    for (let i = 0; i < 4; i++) {
      await service.sendMessage({ workspaceId, conversationId, content: `message ${i}` });
    }

    const history = await service.listMessages(workspaceId, conversationId, 3);
    assert.equal(history.length, 3);

    // The AI provider's last call should only have seen up to historyLimit messages.
    assert.ok(provider.lastRequest!.messages.length <= 3);
  });
});

test('sendMessage applies the memory limit (context limit)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const conversationId = await seedConversation(client, workspaceId);
    const registry = new CapabilityRegistry();
    const permissionEngine = new PermissionEngine(registry);
    const actionLogger = new ActionLogger(client);
    const memoryService = new MemoryService(client, new MockEmbeddingProvider());
    const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
    const provider = new RecordingAIProvider();
    // memoryLimit = 2 for this test
    const service = new ConversationService(
      client,
      memoryService,
      provider,
      actionLogger,
      permissionEngine,
      intentEngine,
      10,
      2,
    );

    for (let i = 0; i < 5; i++) {
      await memoryService.createMemory({ workspaceId, scope: 'workspace', content: `fact number ${i} about planning` });
    }

    const result = await service.sendMessage({ workspaceId, conversationId, content: 'planning facts' });
    assert.ok(result.retrievedMemories.length <= 2);
  });
});

test('sendMessage attaches detected intent metadata and logs it', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    const { service } = buildService(client, new RecordingAIProvider());

    const result = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Remember that the client prefers email over calls.',
    });

    assert.equal(result.intent.intent, 'remember');
    assert.equal(result.intent.approval, 'no_approval_needed');
    assert.match(result.intent.suggestedNextAction, /Store this as a memory/);

    const log = await client.query<{ payload: { detectedIntent?: string } }>(
      'SELECT payload FROM action_log WHERE workspace_id = $1',
      [workspaceId],
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].payload.detectedIntent, 'remember');
  });
});

test('sendMessage classifies distinct intents for distinct messages', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const conversationId = await seedConversation(client, workspaceId);
    const { service } = buildService(client, new RecordingAIProvider());

    const task = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Remind me to review the pull request tomorrow.',
    });
    assert.equal(task.intent.intent, 'create_task');

    const email = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Draft an email to the team about the release.',
    });
    assert.equal(email.intent.intent, 'draft_email');

    const summary = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Summarize this thread for me.',
    });
    assert.equal(summary.intent.intent, 'summarize');
  });
});

test('sendMessage result matches the full response schema', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const conversationId = await seedConversation(client, workspaceId);
    const { service } = buildService(client, new RecordingAIProvider());

    const result = await service.sendMessage({ workspaceId, conversationId, content: 'What day is it?' });

    assert.deepEqual(Object.keys(result).sort(), [
      'assistantMessage',
      'intent',
      'retrievedMemories',
      'userMessage',
    ]);

    assert.equal(typeof result.userMessage.content, 'string');
    assert.equal(typeof result.assistantMessage.content, 'string');
    assert.ok(Array.isArray(result.retrievedMemories));

    assert.deepEqual(Object.keys(result.intent).sort(), [
      'approval',
      'confidence',
      'intent',
      'suggestedNextAction',
    ]);
    assert.equal(typeof result.intent.intent, 'string');
    assert.equal(typeof result.intent.confidence, 'number');
    assert.ok(result.intent.confidence >= 0 && result.intent.confidence <= 1);
    assert.ok(['no_approval_needed', 'approval_required', 'approved', 'denied'].includes(result.intent.approval));
    assert.equal(typeof result.intent.suggestedNextAction, 'string');
  });
});
