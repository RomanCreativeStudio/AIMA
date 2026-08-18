/** Anything with a `[0, 1]` confidence score can be ranked this way — a unified `Suggestion` (Phase 3.5, item 4), regardless of its concrete type (workflow/execution/memory/task/integration). */
export interface RankableSuggestion {
  confidence: number;
}

/** Highest confidence first — the same plain, no-AI sort `rankMemoryCandidates` (Phase 3.4) established for advisory candidates. */
export function rankSuggestions<T extends RankableSuggestion>(suggestions: readonly T[]): T[] {
  return [...suggestions].sort((a, b) => b.confidence - a.confidence);
}
