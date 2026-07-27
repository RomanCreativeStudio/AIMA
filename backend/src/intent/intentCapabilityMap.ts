import type { Intent } from '@aima/ai-engine';

/**
 * Maps each structured intent to the capability that would be invoked if
 * AIMA acted on it — the capability registry entry (backend/src/permissions
 * /registry.ts) is what actually decides the tier. `null` means the intent
 * has no associated capability (a pure read, or nothing detected).
 */
export const INTENT_CAPABILITY_MAP: Record<Intent, string | null> = {
  chat: 'generate_ai_response',
  remember: 'create_memory',
  create_task: 'create_task',
  draft_email: 'draft_email',
  summarize: 'summarize_content',
  search_memory: null,
  unknown: null,
};

/** Human-readable description of what AIMA would do next for each intent — part of the response schema. */
export const SUGGESTED_NEXT_ACTIONS: Record<Intent, string> = {
  chat: 'No action needed — this is a conversational response.',
  remember: 'Store this as a memory in the current workspace.',
  create_task: 'Create a task in the current workspace.',
  draft_email: 'Prepare an email draft for your review.',
  summarize: 'Summarize the requested content.',
  search_memory: 'Search stored memory for relevant results.',
  unknown: 'No specific action detected; treated as general conversation.',
};
