/**
 * The AI Memory Intelligence layer's provider abstraction (Phase 3.4,
 * docs/decisions/0019-advanced-memory-system.md) — mirrors `IntentClassifier`
 * exactly: a pure function from text to structured candidates, no
 * persistence, no side effect. Extraction only ever *suggests* — nothing
 * implementing this interface may create a memory itself; a human (or a
 * caller explicitly acting on their behalf) always makes the actual save
 * call, preserving "no hidden memory creation."
 */
export type MemoryCandidateCategory = 'fact' | 'preference';

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
