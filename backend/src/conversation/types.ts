import type { ApprovalDecision } from '../approval/types';
import type { RankedDocumentChunkResult } from '../knowledge/types';
import type { RankedMemoryResult } from '../memory/types';
import type { IntentAnalysis } from '../intent/types';
import type { WorkflowSuggestion } from '../workflows/types';
import type { ExecutionSuggestion } from '../execution/types';

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
  /** The real approval lifecycle decision for the detected intent's mapped capability, if any (docs/decisions/0007-intent-and-approval-workflows.md). */
  approvalDecision: ApprovalDecision;
  /** An advisory workflow preview (Phase 2.4, item 4), present when the message matches one of the built-in workflows. Never itself creates or executes a run. */
  workflowSuggestion: WorkflowSuggestion | null;
  /** An advisory execution preview (Phase 2.6, item 5), present when the message matches a real external action. Never itself creates or runs an execution — the user must go through a dedicated execution request. */
  executionSuggestion: ExecutionSuggestion | null;
}
