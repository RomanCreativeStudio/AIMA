import type { RankedDocumentChunkResult } from '../knowledge/types';
import type { RankedMemoryResult } from '../memory/types';
import type { IntentAnalysis } from '../intent/types';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  workspaceId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface SendMessageInput {
  workspaceId: string;
  conversationId: string;
  content: string;
}

export interface SendMessageResult {
  userMessage: Message;
  assistantMessage: Message;
  /** What was retrieved and injected into this request's system prompt — surfaced for transparency. */
  retrievedMemories: RankedMemoryResult[];
  /** Document chunks retrieved and injected into this request's system prompt. */
  retrievedDocumentChunks: RankedDocumentChunkResult[];
  /** Structured intent metadata for the user's message (docs/TECHNICAL_ARCHITECTURE.md §4, Response Schema). */
  intent: IntentAnalysis;
}
