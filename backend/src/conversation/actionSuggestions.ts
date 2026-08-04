import type { ActionCandidate, MemoryCandidate, MemoryCandidateCategory } from '@aima/ai-engine';

/**
 * Conversation → Action sprint: the five categories the sprint asks
 * `sendMessage` to detect. `todo`/`follow_up`/`meeting` come from the new
 * `ActionDetector`; `reminder`/`decision` are NOT re-detected here — they
 * reuse the exact `MemoryCandidate`s `sendMessage` already computes via
 * `MemoryExtractor` (see `buildActionSuggestions` below), avoiding a second
 * regex pass over the same phrasing.
 */
export type ActionSuggestionCategory = 'todo' | 'follow_up' | 'reminder' | 'meeting' | 'decision';

export interface ActionSuggestion {
  content: string;
  category: ActionSuggestionCategory;
  confidence: number;
  reason: string;
}

/** The `MemoryCandidate` categories folded into `ActionSuggestion`s rather than re-detected. */
const REUSED_MEMORY_CATEGORIES: ReadonlySet<MemoryCandidateCategory> = new Set(['reminder', 'decision']);

/**
 * Combines the `ActionDetector`'s todo/follow_up/meeting candidates with the
 * reminder/decision candidates `ConversationService.sendMessage` already
 * extracted via `MemoryExtractor` for this same turn — one extraction pass
 * per concern, not two. `decision` suggestions are included for API
 * transparency (mirroring `memorySuggestions`' "report everything detected"
 * posture) even though a wired-in `MemoryService` already silently
 * auto-saves them (Personal Workspace Memory sprint); the Chat UI simply
 * doesn't render an Accept/Dismiss card for that category since there is
 * nothing left to accept.
 *
 * Deduplicates by normalized (trimmed, lowercased) content across the two
 * independent sources, first match wins — the same phrase should never be
 * offered twice just because two different rules happened to match it.
 */
export function buildActionSuggestions(
  actionCandidates: readonly ActionCandidate[],
  memoryCandidates: readonly MemoryCandidate[],
): ActionSuggestion[] {
  const combined: ActionSuggestion[] = actionCandidates.map((candidate) => ({
    content: candidate.content,
    category: candidate.category,
    confidence: candidate.confidence,
    reason: candidate.reason,
  }));

  for (const candidate of memoryCandidates) {
    if (!REUSED_MEMORY_CATEGORIES.has(candidate.category)) {
      continue;
    }
    combined.push({
      content: candidate.content,
      category: candidate.category as 'reminder' | 'decision',
      confidence: candidate.confidence,
      reason: candidate.reason,
    });
  }

  const seen = new Set<string>();
  const deduped: ActionSuggestion[] = [];
  for (const suggestion of combined) {
    const key = suggestion.content.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(suggestion);
  }

  return deduped;
}
