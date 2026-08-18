import type { ApprovalDecision } from '../approval/types';
import type { IntentAnalysis } from '../intent/types';
import type { WorkflowSuggestion } from '../workflows/types';
import type { ExecutionSuggestion } from '../execution/types';

export type VoiceSessionStatus = 'active' | 'ended';

export interface VoiceSession {
  id: string;
  workspaceId: string;
  /** Set at session start — every voice session drives a real, listable conversation, never a parallel history. */
  conversationId: string;
  status: VoiceSessionStatus;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Transcript {
  text: string;
  /** 0-1, when the speech-to-text provider reports one. */
  confidence: number | null;
}

export interface VoiceTurn {
  id: string;
  voiceSessionId: string;
  workspaceId: string;
  transcript: Transcript;
  responseText: string;
  createdAt: string;
}

/** Per-request speech synthesis preferences — forwarded to the TextToSpeechProvider, never persisted. */
export interface VoiceConfiguration {
  voice?: string;
  speakingRate?: number;
}

export interface SubmitVoiceRequestInput {
  workspaceId: string;
  voiceSessionId: string;
  /** Raw encoded audio bytes captured client-side — never written to storage (this phase's "no audio persistence by default" requirement). */
  audioData: Buffer;
  audioMimeType: string;
  configuration?: VoiceConfiguration;
}

export interface VoiceResponse {
  turn: VoiceTurn;
  /** Synthesized speech for `turn.responseText` — returned to the caller, never persisted. */
  audio: {
    data: Buffer;
    mimeType: string;
  };
  intent: IntentAnalysis;
  approvalDecision: ApprovalDecision;
  workflowSuggestion: WorkflowSuggestion | null;
  executionSuggestion: ExecutionSuggestion | null;
}
