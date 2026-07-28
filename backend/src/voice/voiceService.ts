import type { SpeechToTextProvider, TextToSpeechProvider } from '@aima/ai-engine';
import type { ConversationService } from '../conversation/conversationService';
import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import { InvalidVoiceSessionStateError, VoiceProviderError, VoiceSessionNotFoundError } from './errors';
import type { SubmitVoiceRequestInput, VoiceResponse, VoiceSession, VoiceTurn } from './types';

const VOICE_SESSION_CONVERSATION_TITLE = 'Voice Session';

/**
 * The Voice Assistant Foundation's orchestrator (Phase 3.2): a voice session
 * is a thin wrapper around a real conversation — it drives the existing
 * `ConversationService`/`AimaCoreService` pipeline (context, intent
 * detection, approval evaluation, workflow/execution suggestions) rather
 * than re-implementing any of it, the same "push new behavior behind an
 * existing seam" approach ADR 0015 used for OAuth token refresh
 * (docs/decisions/0017-voice-assistant-foundation.md). `VoiceService`
 * depends only on the `SpeechToTextProvider`/`TextToSpeechProvider`
 * interfaces, never a concrete vendor — no live network call happens here,
 * matching this phase's "no vendor lock-in" requirement.
 *
 * No audio is ever persisted: `submitVoiceRequest` transcribes the caller's
 * audio buffer and synthesizes the reply's audio entirely in memory, storing
 * only the transcript text and the response text (`voice_turns`).
 */
export class VoiceService {
  constructor(
    private readonly db: Queryable,
    private readonly conversationService: ConversationService,
    private readonly speechToTextProvider: SpeechToTextProvider,
    private readonly textToSpeechProvider: TextToSpeechProvider,
  ) {}

  /** Requires an explicit caller-initiated call — there is no automatic or background session creation anywhere in this codebase. */
  async startSession(workspaceId: string): Promise<VoiceSession> {
    await this.assertWorkspaceExists(workspaceId);
    const conversation = await this.conversationService.createConversation(workspaceId, VOICE_SESSION_CONVERSATION_TITLE);

    const result = await this.db.query<VoiceSessionRow>(
      `INSERT INTO voice_sessions (workspace_id, conversation_id, status)
       VALUES ($1, $2, 'active')
       RETURNING id, workspace_id, conversation_id, status, started_at, ended_at, created_at, updated_at`,
      [workspaceId, conversation.id],
    );

    return mapVoiceSessionRow(result.rows[0]);
  }

  async endSession(workspaceId: string, voiceSessionId: string): Promise<VoiceSession> {
    const session = await this.getSession(workspaceId, voiceSessionId);
    if (session.status !== 'active') {
      throw new InvalidVoiceSessionStateError('end', session.status);
    }

    const result = await this.db.query<VoiceSessionRow>(
      `UPDATE voice_sessions SET status = 'ended', ended_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING id, workspace_id, conversation_id, status, started_at, ended_at, created_at, updated_at`,
      [voiceSessionId],
    );

    return mapVoiceSessionRow(result.rows[0]);
  }

  async getSession(workspaceId: string, voiceSessionId: string): Promise<VoiceSession> {
    const result = await this.db.query<VoiceSessionRow>(
      `SELECT id, workspace_id, conversation_id, status, started_at, ended_at, created_at, updated_at
       FROM voice_sessions WHERE id = $1 AND workspace_id = $2`,
      [voiceSessionId, workspaceId],
    );
    if (result.rows.length === 0) {
      throw new VoiceSessionNotFoundError(voiceSessionId, workspaceId);
    }
    return mapVoiceSessionRow(result.rows[0]);
  }

  async listSessions(workspaceId: string): Promise<VoiceSession[]> {
    await this.assertWorkspaceExists(workspaceId);
    const result = await this.db.query<VoiceSessionRow>(
      `SELECT id, workspace_id, conversation_id, status, started_at, ended_at, created_at, updated_at
       FROM voice_sessions WHERE workspace_id = $1 ORDER BY sequence DESC`,
      [workspaceId],
    );
    return result.rows.map(mapVoiceSessionRow);
  }

  async listTurns(workspaceId: string, voiceSessionId: string): Promise<VoiceTurn[]> {
    await this.getSession(workspaceId, voiceSessionId);
    const result = await this.db.query<VoiceTurnRow>(
      `SELECT id, voice_session_id, workspace_id, transcript_text, transcript_confidence, response_text, created_at
       FROM voice_turns WHERE voice_session_id = $1 ORDER BY sequence ASC`,
      [voiceSessionId],
    );
    return result.rows.map(mapVoiceTurnRow);
  }

  /**
   * Audio in, audio out — Speech-to-Text → AIMA Core (via `ConversationService.
   * sendMessage`, unmodified) → Text-to-Speech. Rejects up front if the
   * session has already ended, since a voice request against a closed
   * session isn't a valid continuation of anything.
   */
  async submitVoiceRequest(input: SubmitVoiceRequestInput): Promise<VoiceResponse> {
    const session = await this.getSession(input.workspaceId, input.voiceSessionId);
    if (session.status !== 'active') {
      throw new InvalidVoiceSessionStateError('submit a voice request to', session.status);
    }

    let transcription;
    try {
      transcription = await this.speechToTextProvider.transcribe({
        data: input.audioData,
        mimeType: input.audioMimeType,
      });
    } catch (error) {
      throw new VoiceProviderError('speech-to-text', error);
    }

    const sendResult = await this.conversationService.sendMessage({
      workspaceId: input.workspaceId,
      conversationId: session.conversationId,
      content: transcription.text,
    });

    let synthesis;
    try {
      synthesis = await this.textToSpeechProvider.synthesize(sendResult.assistantMessage.content, input.configuration);
    } catch (error) {
      throw new VoiceProviderError('text-to-speech', error);
    }

    const turnResult = await this.db.query<VoiceTurnRow>(
      `INSERT INTO voice_turns (voice_session_id, workspace_id, transcript_text, transcript_confidence, response_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, voice_session_id, workspace_id, transcript_text, transcript_confidence, response_text, created_at`,
      [
        input.voiceSessionId,
        input.workspaceId,
        transcription.text,
        transcription.confidence ?? null,
        sendResult.assistantMessage.content,
      ],
    );

    return {
      turn: mapVoiceTurnRow(turnResult.rows[0]),
      audio: { data: synthesis.audio, mimeType: synthesis.mimeType },
      intent: sendResult.intent,
      approvalDecision: sendResult.approvalDecision,
      workflowSuggestion: sendResult.workflowSuggestion,
      executionSuggestion: sendResult.executionSuggestion,
    };
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface VoiceSessionRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  status: 'active' | 'ended';
  started_at: Date | string;
  ended_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapVoiceSessionRow(row: VoiceSessionRow): VoiceSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    status: row.status,
    startedAt: toIso(row.started_at),
    endedAt: row.ended_at === null ? null : toIso(row.ended_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface VoiceTurnRow {
  id: string;
  voice_session_id: string;
  workspace_id: string;
  transcript_text: string;
  transcript_confidence: number | null;
  response_text: string;
  created_at: Date | string;
}

function mapVoiceTurnRow(row: VoiceTurnRow): VoiceTurn {
  return {
    id: row.id,
    voiceSessionId: row.voice_session_id,
    workspaceId: row.workspace_id,
    transcript: { text: row.transcript_text, confidence: row.transcript_confidence },
    responseText: row.response_text,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
