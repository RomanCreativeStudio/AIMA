/** One occurrence of some backend-domain event, reduced to just what pattern detection needs — no knowledge of tasks/workflows/approvals here, only a grouping key and a timestamp. */
export interface OccurrenceEvent {
  key: string;
  occurredAt: string;
}

/** A key that recurred at least the caller's `minOccurrences` threshold, with a confidence score and the first/last time it was seen. */
export interface RecurringPattern {
  key: string;
  occurrences: number;
  confidence: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
}

export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

export interface TrendResult {
  direction: TrendDirection;
  /** `(recent - prior) / prior`, or 1 if `prior` is 0 and `recent` is not. 0 when both counts are equal. */
  changeRatio: number;
  confidence: number;
}
