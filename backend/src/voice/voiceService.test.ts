import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '@aima/ai-engine';
import { MockEmbeddingProvider, MockSpeechToTextProvider, MockTextToSpeechProvider, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { ActionLogger } from '../actionLog/logger';
import { ApprovalEngine } from '../approval/approvalEngine';
import { AimaCoreService } from '../core/aimaCoreService';
import { ContextManager } from '../core/contextManager';
import { ConversationService } from '../conversation/conversationService';
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
import { GmailSendEmailExecutor } from '../execution/executors/gmailSendEmailExecutor';
import { StubGmailConnector } from '../integrations/connectors/gmailConnector';
import { WorkspaceNotFoundError } from '../types/errors';
import { InvalidVoiceSessionStateError, VoiceSessionNotFoundError } from './errors';
import { VoiceService } from './voiceService';

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

function buildVoiceService(client: Client, provider: AIProvider = new RecordingAIProvider()): VoiceService {
  const registry = new CapabilityRegistry();
  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(client);
  const memoryService = new MemoryService(client, new MockEmbeddingProvider());
  const documentService = new DocumentService(client, new MockEmbeddingProvider());
  const preferenceService = new PreferenceService(client);
  const intentEngine = new IntentEngine(new RuleBasedIntentClassifier(), permissionEngine);
  const approvalEngine = new ApprovalEngine(client, permissionEngine);
  const workspaceService = new WorkspaceService(client);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const aimaCoreService = new AimaCoreService(contextManager, provider, intentEngine, approvalEngine, workspaceService);
  const workflowIntentMatcher = new WorkflowIntentMatcher(new WorkflowRegistry());
  const executionIntentMatcher = new ExecutionIntentMatcher(
    new ExecutionRegistry([new GmailSendEmailExecutor(new StubGmailConnector())]),
  );

  const conversationService = new ConversationService({
    db: client,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
    executionIntentMatcher,
  });

  return new VoiceService(client, conversationService, new MockSpeechToTextProvider(), new MockTextToSpeechProvider());
}

test('startSession creates an active session backed by a real, listable conversation', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);

    const session = await voiceService.startSession(workspaceId);

    assert.equal(session.workspaceId, workspaceId);
    assert.equal(session.status, 'active');
    assert.equal(session.endedAt, null);
    assert.ok(session.conversationId);

    const conversation = await client.query('SELECT id FROM conversations WHERE id = $1 AND workspace_id = $2', [
      session.conversationId,
      workspaceId,
    ]);
    assert.equal(conversation.rows.length, 1);
  });
});

test('startSession throws WorkspaceNotFoundError for an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    const voiceService = buildVoiceService(client);
    await assert.rejects(() => voiceService.startSession('00000000-0000-0000-0000-000000000000'), WorkspaceNotFoundError);
  });
});

test('endSession marks an active session ended and stamps endedAt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceId);

    const ended = await voiceService.endSession(workspaceId, session.id);

    assert.equal(ended.status, 'ended');
    assert.ok(ended.endedAt);
  });
});

test('endSession rejects a session that is already ended', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceId);
    await voiceService.endSession(workspaceId, session.id);

    await assert.rejects(() => voiceService.endSession(workspaceId, session.id), InvalidVoiceSessionStateError);
  });
});

test('getSession 404s for a session belonging to a different workspace (isolation)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId: workspaceA } = await seedWorkspace(client, 'rcs');
    const { workspaceId: workspaceB } = await seedWorkspace(client, 'mfs');
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceA);

    await assert.rejects(() => voiceService.getSession(workspaceB, session.id), VoiceSessionNotFoundError);
  });
});

test('listSessions is scoped to the workspace and ordered newest first', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId: workspaceA } = await seedWorkspace(client, 'rcs');
    const { workspaceId: workspaceB } = await seedWorkspace(client, 'mfs');
    const voiceService = buildVoiceService(client);

    const first = await voiceService.startSession(workspaceA);
    const second = await voiceService.startSession(workspaceA);
    await voiceService.startSession(workspaceB);

    const sessions = await voiceService.listSessions(workspaceA);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, second.id);
    assert.equal(sessions[1].id, first.id);
  });
});

test('submitVoiceRequest transcribes, runs the real conversation pipeline, and synthesizes a reply', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceId);

    const response = await voiceService.submitVoiceRequest({
      workspaceId,
      voiceSessionId: session.id,
      audioData: Buffer.from('What is on my schedule today?', 'utf-8'),
      audioMimeType: 'audio/wav',
    });

    assert.equal(response.turn.transcript.text, 'What is on my schedule today?');
    assert.equal(response.turn.transcript.confidence, 1);
    assert.match(response.turn.responseText, /^echo: /);
    assert.equal(response.audio.mimeType, 'text/plain');
    assert.equal(response.audio.data.toString('utf-8'), response.turn.responseText);
    assert.ok(response.intent);
    assert.ok(response.approvalDecision);
  });
});

test('submitVoiceRequest persists no raw audio — only transcript and response text', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceId);

    await voiceService.submitVoiceRequest({
      workspaceId,
      voiceSessionId: session.id,
      audioData: Buffer.from('remember this secret audio payload', 'utf-8'),
      audioMimeType: 'audio/wav',
    });

    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'voice_turns'`,
    );
    const columnNames = columns.rows.map((row) => row.column_name as string);
    assert.ok(!columnNames.some((name) => name.toLowerCase().includes('audio')));
  });
});

test('submitVoiceRequest rejects a request against an ended session', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceId);
    await voiceService.endSession(workspaceId, session.id);

    await assert.rejects(
      () =>
        voiceService.submitVoiceRequest({
          workspaceId,
          voiceSessionId: session.id,
          audioData: Buffer.from('hello', 'utf-8'),
          audioMimeType: 'audio/wav',
        }),
      InvalidVoiceSessionStateError,
    );
  });
});

test('listTurns returns turns oldest-first for the session', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client);
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceId);

    await voiceService.submitVoiceRequest({
      workspaceId,
      voiceSessionId: session.id,
      audioData: Buffer.from('first turn', 'utf-8'),
      audioMimeType: 'audio/wav',
    });
    await voiceService.submitVoiceRequest({
      workspaceId,
      voiceSessionId: session.id,
      audioData: Buffer.from('second turn', 'utf-8'),
      audioMimeType: 'audio/wav',
    });

    const turns = await voiceService.listTurns(workspaceId, session.id);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].transcript.text, 'first turn');
    assert.equal(turns[1].transcript.text, 'second turn');
  });
});

test('listTurns 404s for a session belonging to a different workspace (isolation)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId: workspaceA } = await seedWorkspace(client, 'rcs');
    const { workspaceId: workspaceB } = await seedWorkspace(client, 'mfs');
    const voiceService = buildVoiceService(client);
    const session = await voiceService.startSession(workspaceA);

    await assert.rejects(() => voiceService.listTurns(workspaceB, session.id), VoiceSessionNotFoundError);
  });
});
