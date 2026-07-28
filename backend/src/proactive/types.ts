export const SUGGESTION_TYPES = ['workflow', 'execution', 'memory', 'task', 'integration'] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

/**
 * The unified, advisory suggestion shape (Phase 3.5, item 4) — every kind of proactive recommendation
 * (workflow/execution/memory/task/integration) is rendered through this one interface so a client can display
 * them uniformly. Explainable by construction: `source` names the detector/rule that produced it, `explanation`
 * is a human-readable reason, `confidence` is `[0, 1]`. Never persisted — computed fresh on every request, and
 * never itself creates, executes, or sends anything (docs/decisions/0020-proactive-intelligence.md).
 */
export interface Suggestion {
  id: string;
  workspaceId: string;
  type: SuggestionType;
  title: string;
  explanation: string;
  confidence: number;
  source: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export const PATTERN_TYPES = [
  'repeated_task',
  'frequent_workflow',
  'recurring_approval',
  'missed_deadline',
  'activity_trend',
  'memory_usage_trend',
] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

/**
 * One deterministically-detected pattern in a workspace's existing data (Phase 3.5, item 3) — no ML, no
 * training, just counting/grouping/windowing what's already stored. `confidence` always reflects how strong the
 * signal is (more occurrences, or a trend backed by more samples), never a guess.
 */
export interface Pattern {
  workspaceId: string;
  type: PatternType;
  description: string;
  confidence: number;
  occurrences: number;
  detectedAt: string;
  metadata: Record<string, unknown>;
}
