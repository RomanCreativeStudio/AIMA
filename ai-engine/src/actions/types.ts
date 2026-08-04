/**
 * Conversation → Action sprint: forward-looking actionable items detected in
 * a message — distinct from `MemoryCandidate` (which captures things worth
 * *remembering*, past-tense outcomes). `reminder` and `decision` are
 * deliberately NOT part of this category set: both are already detected by
 * `MemoryExtractor` and, for a wired-in `MemoryService`, already silently
 * auto-saved (Personal Workspace Memory sprint) — the backend's
 * `buildActionSuggestions` reuses those candidates rather than re-detecting
 * the same phrasing here. `completed_task` is the same story (also
 * `MemoryExtractor`, also reused, not re-detected). This detector only
 * covers genuinely new categories: `todo`/`follow_up`/`meeting` (Conversation
 * → Action sprint) and `blocked`/`postponed`/`delegated` (Executive Assistant
 * Loop sprint) — task-status transitions with no existing detector to reuse.
 */
export type ActionCandidateCategory = 'todo' | 'follow_up' | 'meeting' | 'blocked' | 'postponed' | 'delegated';

export interface ActionCandidate {
  /** The text to offer as a candidate action — not rewritten from the source, so a user can see exactly why it was suggested. */
  content: string;
  category: ActionCandidateCategory;
  /** How confident the detector is that this candidate is genuinely actionable, in [0, 1]. */
  confidence: number;
  /** Human-readable explanation of which rule matched — the "explainable" requirement. */
  reason: string;
}

export interface ActionDetector {
  readonly name: string;
  detect(text: string): ActionCandidate[];
}
