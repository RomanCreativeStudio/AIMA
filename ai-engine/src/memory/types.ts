/**
 * The AI Memory Intelligence layer's provider abstraction (Phase 3.4,
 * docs/decisions/0019-advanced-memory-system.md) — mirrors `IntentClassifier`
 * exactly: a pure function from text to structured candidates, no
 * persistence, no side effect. Extraction only ever *suggests* — nothing
 * implementing this interface may create a memory itself; the decision of
 * whether (and how) to act on a candidate always belongs to the caller.
 * Originally every category stayed advisory-only until a human explicitly
 * confirmed it; the Personal Workspace Memory sprint lets `ConversationService`
 * auto-save specific categories (`preference`, `completed_task`, `decision`,
 * `reminder`, `project_update` — see `ConversationService`'s own
 * `AUTO_SAVE_CATEGORIES`) on the caller's behalf, while `fact` stays
 * advisory-only. That's still "no hidden memory creation from the extractor
 * itself" — this interface never persists anything either way.
 */
export type MemoryCandidateCategory = 'fact' | 'preference' | 'completed_task' | 'decision' | 'reminder' | 'project_update';

export interface MemoryCandidate {
  /** The text to offer as a candidate memory — not rewritten from the source, so a user can see exactly why it was suggested. */
  content: string;
  category: MemoryCandidateCategory;
  /** How significant this candidate would be if saved, in [0, 1]. */
  importance: number;
  /** How confident the extractor is that this candidate is genuinely a fact/preference worth saving, in [0, 1]. */
  confidence: number;
  /** Human-readable explanation of which rule matched — the "explainable" requirement: a user (or a test) can see exactly why this was suggested. */
  reason: string;
}

export interface MemoryExtractor {
  readonly name: string;
  extract(text: string): MemoryCandidate[];
}
