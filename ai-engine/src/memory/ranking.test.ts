import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoryCandidate } from './types';
import { rankMemoryCandidates } from './ranking';

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    content: 'x',
    category: 'fact',
    importance: 0.5,
    confidence: 0.5,
    reason: 'test fixture',
    ...overrides,
  };
}

test('rankMemoryCandidates() orders by confidence × importance, highest first', () => {
  const low = candidate({ content: 'low', confidence: 0.5, importance: 0.5 });
  const high = candidate({ content: 'high', confidence: 0.9, importance: 0.9 });
  const mid = candidate({ content: 'mid', confidence: 0.7, importance: 0.7 });

  const ranked = rankMemoryCandidates([low, mid, high]);

  assert.deepEqual(
    ranked.map((c) => c.content),
    ['high', 'mid', 'low'],
  );
});

test('rankMemoryCandidates() does not mutate the input array', () => {
  const input = [candidate({ content: 'a', confidence: 0.2 }), candidate({ content: 'b', confidence: 0.9 })];
  const original = [...input];

  rankMemoryCandidates(input);

  assert.deepEqual(input, original);
});

test('rankMemoryCandidates() handles an empty list', () => {
  assert.deepEqual(rankMemoryCandidates([]), []);
});
