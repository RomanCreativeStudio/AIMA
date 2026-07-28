import type { OccurrenceEvent, RecurringPattern, TrendDirection, TrendResult } from './types';

export const DEFAULT_MIN_OCCURRENCES = 2;

/**
 * Grows from 0.5 at exactly `minOccurrences` toward 1 as occurrences climb further past it — never above 1,
 * never returned for anything below the threshold (0 instead). Deterministic, no ML: more repetitions of the
 * same thing is a stronger, but never certain, signal.
 */
export function computeRecurrenceConfidence(occurrences: number, minOccurrences: number): number {
  if (occurrences < minOccurrences) {
    return 0;
  }
  const scaled = (occurrences - minOccurrences) / (minOccurrences * 2);
  return Math.min(1, 0.5 + scaled * 0.5);
}

/**
 * Groups events by `key` and reports every key that recurred at least `minOccurrences` times — the shared
 * detection logic behind "repeated tasks," "frequently used workflows," and "recurring approvals" (Phase 3.5,
 * item 3): all three are the same "does X recur" question, just fed a different key extractor by the caller.
 * Pure and deterministic — no AI call, mirroring `RuleBasedIntentClassifier`/`RuleBasedMemoryExtractor`'s
 * "no model, just counting/matching what's already known" precedent.
 */
export function detectRecurringPatterns(
  events: readonly OccurrenceEvent[],
  minOccurrences: number = DEFAULT_MIN_OCCURRENCES,
): RecurringPattern[] {
  const byKey = new Map<string, OccurrenceEvent[]>();
  for (const event of events) {
    const existing = byKey.get(event.key);
    if (existing) {
      existing.push(event);
    } else {
      byKey.set(event.key, [event]);
    }
  }

  const patterns: RecurringPattern[] = [];
  for (const [key, occurrences] of byKey) {
    if (occurrences.length < minOccurrences) {
      continue;
    }
    const sorted = [...occurrences].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
    patterns.push({
      key,
      occurrences: occurrences.length,
      confidence: computeRecurrenceConfidence(occurrences.length, minOccurrences),
      firstOccurredAt: sorted[0].occurredAt,
      lastOccurredAt: sorted[sorted.length - 1].occurredAt,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

/** More combined samples across both windows means more confidence in the trend reading — sparse data (e.g. one event total) is never reported as a confident trend. */
function computeTrendConfidence(totalSamples: number): number {
  return Math.min(1, 0.2 + totalSamples / 20);
}

/**
 * Compares two already-windowed counts (e.g. "this week" vs "last week") — the caller does the windowing
 * (backend-domain concern), this function only reasons about the two numbers. Deterministic: equal counts are
 * `stable`; otherwise direction follows the sign of the difference, and `changeRatio` is 1 (maximally
 * "increasing") when `priorCount` is 0 and `recentCount` is not, avoiding a divide-by-zero.
 */
export function detectTrend(recentCount: number, priorCount: number): TrendResult {
  const confidence = computeTrendConfidence(recentCount + priorCount);

  if (recentCount === priorCount) {
    return { direction: 'stable', changeRatio: 0, confidence };
  }

  const direction: TrendDirection = recentCount > priorCount ? 'increasing' : 'decreasing';
  const changeRatio = priorCount === 0 ? 1 : (recentCount - priorCount) / priorCount;
  return { direction, changeRatio, confidence };
}
