import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { MockEmbeddingProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { seedCapabilities, seedConversation, seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AimaCoreService } from '../core/aimaCoreService';
import { ContextManager } from '../core/contextManager';
import { IntentEngine } from '../intent/intentEngine';
import { DocumentService } from '../knowledge/documentService';
import { MemoryService } from '../memory/memoryService';
import { CapabilityRegistry, DEFAULT_CAPABILITIES } from '../permissions/registry';
import { PermissionEngine } from '../permissions/engine';
import { ConversationService, type ConversationServiceDependencies } from './conversationService';
import { WorkspaceNotFoundError } from '../types/errors';
import { ConversationNotFoundError } from './errors';

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

function buildService(
  client: Client,
  provider: AIProvider,
  overrides: Partial<ConversationServiceDependencies> = {},
  registry: CapabilityRegistry = new CapabilityRegistry(),
) {
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const documentService = new DocumentService(client, new MockEmbeddingProvider());
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const contextManager = new ContextManager(memoryService, documentService);
  const aimaCoreService = new AimaCoreService(contextManager, provider, intentEngine, approvalEngine);

  const service = new ConversationService({
    db: client,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    ...overrides,
  });

  return { service, memoryService, documentService };
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

test('sendMessage retrieves relevant document chunks and includes them in the system prompt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    const provider = new RecordingAIProvider();
    const { service, documentService } = buildService(client, provider);

    await documentService.importDocument({
      workspaceId,
      format: 'markdown',
      title: 'Onboarding Guide',
      content: '# Onboarding\n\nSchedule a kickoff call and draft a proposal covering scope and price.',
    });

    const result = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'How do we onboard a new client?',
    });

    assert.ok(result.retrievedDocumentChunks.length > 0);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Relevant documentation for this workspace/);
    assert.match(provider.lastRequest!.systemPrompt ?? '', /Onboarding Guide/);
  });
});

test('sendMessage never retrieves document chunks from a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const rcs = await seedWorkspace(client, 'rcs');
    const mfs = await seedWorkspace(client, 'mfs');
    const conversationId = await seedConversation(client, rcs.workspaceId);
    const provider = new RecordingAIProvider();
    const { service, documentService } = buildService(client, provider);

    await documentService.importDocument({
      workspaceId: mfs.workspaceId,
      format: 'plaintext',
      content: 'Character backstory notes for Kestrel that should never leak into RCS.',
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
    const provider = new RecordingAIProvider();
    const { service } = buildService(client, provider, { historyLimit: 3 });

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
    const provider = new RecordingAIProvider();
    const { service, memoryService } = buildService(client, provider, { memoryLimit: 2 });

    for (let i = 0; i < 5; i++) {
      await memoryService.createMemory({ workspaceId, scope: 'workspace', content: `fact number ${i} about planning` });
    }

    const result = await service.sendMessage({ workspaceId, conversationId, content: 'planning facts' });
    assert.ok(result.retrievedMemories.length <= 2);
  });
});

test('sendMessage applies the document limit (context limit)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const conversationId = await seedConversation(client, workspaceId);
    const provider = new RecordingAIProvider();
    const { service, documentService } = buildService(client, provider, { documentLimit: 2 });

    for (let i = 0; i < 5; i++) {
      await documentService.importDocument({
        workspaceId,
        format: 'plaintext',
        content: `Document number ${i} about planning and scheduling.`,
      });
    }

    const result = await service.sendMessage({ workspaceId, conversationId, content: 'planning documents' });
    assert.ok(result.retrievedDocumentChunks.length <= 2);
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
    assert.equal(result.approvalDecision.state, 'no_approval_needed');
    assert.match(result.intent.suggestedNextAction, /Store this as a memory/);

    const log = await client.query<{ payload: { detectedIntent?: string } }>(
      'SELECT payload FROM action_log WHERE workspace_id = $1',
      [workspaceId],
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].payload.detectedIntent, 'remember');
  });
});

test('sendMessage creates a real pending approval when the detected intent maps to a Tier 3 capability', async () => {
  await withTestTransaction(async (client) => {
    await seedCapabilities(client);
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const conversationId = await seedConversation(client, workspaceId);
    // Elevate create_task to Tier 3 (keeping every other default capability,
    // including generate_ai_response — sendMessage's own action-logging
    // needs it) to prove the conversation pipeline actually creates and
    // surfaces a real pending_approvals row when the detected intent's
    // capability requires approval — not just an advisory flag
    // (docs/decisions/0007-intent-and-approval-workflows.md).
    const registry = new CapabilityRegistry(
      DEFAULT_CAPABILITIES.map((capability) =>
        capability.actionType === 'create_task' ? { ...capability, defaultTier: 'execute_with_approval' } : capability,
      ),
    );
    const { service } = buildService(client, new RecordingAIProvider(), {}, registry);

    const result = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Remind me to follow up with Acme on Friday.',
    });

    assert.equal(result.intent.intent, 'create_task');
    assert.equal(result.intent.approval, 'approval_required');
    assert.equal(result.approvalDecision.state, 'pending');
    assert.ok(result.approvalDecision.pendingApprovalId);

    const row = await client.query('SELECT status, payload FROM pending_approvals WHERE id = $1', [
      result.approvalDecision.pendingApprovalId,
    ]);
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].status, 'pending');
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

    const proposal = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Draft a proposal for the Acme website redesign.',
    });
    assert.equal(proposal.intent.intent, 'draft_proposal');
    assert.equal(proposal.intent.parameters.topic, 'the acme website redesign');

    const docSearch = await service.sendMessage({
      workspaceId,
      conversationId,
      content: 'Search the docs for the onboarding checklist.',
    });
    assert.equal(docSearch.intent.intent, 'search_documents');
    assert.equal(docSearch.intent.parameters.query, 'the onboarding checklist');
  });
});

test('sendMessage result matches the full response schema', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const conversationId = await seedConversation(client, workspaceId);
    const { service } = buildService(client, new RecordingAIProvider());

    const result = await service.sendMessage({ workspaceId, conversationId, content: 'What day is it?' });

    assert.deepEqual(Object.keys(result).sort(), [
      'approvalDecision',
      'assistantMessage',
      'intent',
      'retrievedDocumentChunks',
      'retrievedMemories',
      'userMessage',
    ]);

    assert.equal(typeof result.userMessage.content, 'string');
    assert.equal(typeof result.assistantMessage.content, 'string');
    assert.ok(Array.isArray(result.retrievedMemories));
    assert.ok(Array.isArray(result.retrievedDocumentChunks));

    assert.deepEqual(Object.keys(result.intent).sort(), [
      'approval',
      'confidence',
      'intent',
      'parameters',
      'suggestedNextAction',
    ]);
    assert.equal(typeof result.intent.intent, 'string');
    assert.equal(typeof result.intent.confidence, 'number');
    assert.ok(result.intent.confidence >= 0 && result.intent.confidence <= 1);
    assert.ok(['no_approval_needed', 'approval_required'].includes(result.intent.approval));
    assert.equal(typeof result.intent.suggestedNextAction, 'string');
    assert.equal(result.approvalDecision.state, 'no_approval_needed');
  });
});
