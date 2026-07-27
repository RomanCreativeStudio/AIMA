/** The initial fixed set of structured intents AIMA can detect from a conversation turn. */
export const INTENTS = [
  'chat',
  'remember',
  'create_task',
  'draft_email',
  'draft_proposal',
  'summarize',
  'search_memory',
  'search_documents',
  'unknown',
] as const;

export type Intent = (typeof INTENTS)[number];

export interface IntentDetectionResult {
  intent: Intent;
  /** 0 (no confidence) to 1 (certain). */
  confidence: number;
  /** Loosely extracted slot values (e.g. { title: "..." } for create_task) — best-effort, never required to be present. */
  parameters: Record<string, string>;
}

/**
 * Every intent classifier AIMA can use implements this interface, mirroring
 * the AIProvider/EmbeddingProvider pattern (see ../types.ts and
 * ../embeddings/types.ts) — callers only ever see IntentClassifier, never a
 * concrete implementation.
 */
export interface IntentClassifier {
  readonly name: string;
  classify(message: string): Promise<IntentDetectionResult>;
}
