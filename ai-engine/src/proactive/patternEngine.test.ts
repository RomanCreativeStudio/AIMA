import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRecurrenceConfidence,
  detectRecurringPatterns,
  detectTrend,
} from './patternEngine';
import type { OccurrenceEvent } from './types';

function event(key: string, occurredAt: string): OccurrenceEvent {
  return { key, occurredAt };
}

test('computeRecurrenceConfidence returns 0 below the threshold', () => {
  assert.equal(computeRecurrenceConfidence(1, 2), 0);
});

test('computeRecurrenceConfidence returns 0.5 exactly at the threshold and grows toward 1 beyond it', () => {
  assert.equal(computeRecurrenceConfidence(2, 2), 0.5);
  const higher = computeRecurrenceConfidence(6, 2);
  assert.ok(higher > 0.5 && higher <= 1);
});

test('computeRecurrenceConfidence never exceeds 1', () => {
  assert.equal(computeRecurrenceConfidence(1000, 2), 1);
});

test('detectRecurringPatterns groups by key and excludes anything below minOccurrences', () => {
  const events = [
    event('draft-proposal', '2026-01-01T00:00:00.000Z'),
    event('draft-proposal', '2026-01-02T00:00:00.000Z'),
    event('draft-proposal', '2026-01-03T00:00:00.000Z'),
    event('one-off', '2026-01-01T00:00:00.000Z'),
  ];

  const patterns = detectRecurringPatterns(events, 2);

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].key, 'draft-proposal');
  assert.equal(patterns[0].occurrences, 3);
  assert.equal(patterns[0].firstOccurredAt, '2026-01-01T00:00:00.000Z');
  assert.equal(patterns[0].lastOccurredAt, '2026-01-03T00:00:00.000Z');
});

test('detectRecurringPatterns sorts by occurrence count descending, then key ascending', () => {
  const events = [
    event('b', '2026-01-01T00:00:00.000Z'),
    event('b', '2026-01-02T00:00:00.000Z'),
    event('a', '2026-01-01T00:00:00.000Z'),
    event('a', '2026-01-02T00:00:00.000Z'),
    event('a', '2026-01-03T00:00:00.000Z'),
  ];

  const patterns = detectRecurringPatterns(events, 2);

  assert.deepEqual(
    patterns.map((p) => p.key),
    ['a', 'b'],
  );
});

test('detectRecurringPatterns returns an empty array when nothing recurs', () => {
  assert.deepEqual(detectRecurringPatterns([event('x', '2026-01-01T00:00:00.000Z')], 2), []);
});

test('detectTrend reports stable for equal counts', () => {
  const result = detectTrend(5, 5);
  assert.equal(result.direction, 'stable');
  assert.equal(result.changeRatio, 0);
});

test('detectTrend reports increasing with the correct change ratio', () => {
  const result = detectTrend(10, 5);
  assert.equal(result.direction, 'increasing');
  assert.equal(result.changeRatio, 1);
});

test('detectTrend reports decreasing with the correct change ratio', () => {
  const result = detectTrend(5, 10);
  assert.equal(result.direction, 'decreasing');
  assert.equal(result.changeRatio, -0.5);
});

test('detectTrend avoids a divide-by-zero when priorCount is 0', () => {
  const result = detectTrend(3, 0);
  assert.equal(result.direction, 'increasing');
  assert.equal(result.changeRatio, 1);
});

test('detectTrend confidence grows with more combined samples', () => {
  const sparse = detectTrend(1, 0);
  const dense = detectTrend(20, 15);
  assert.ok(dense.confidence > sparse.confidence);
});
