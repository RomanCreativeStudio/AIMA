import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSuggestions } from './ranking';

test('rankSuggestions orders by confidence descending', () => {
  const items = [{ confidence: 0.3 }, { confidence: 0.9 }, { confidence: 0.6 }];
  assert.deepEqual(
    rankSuggestions(items).map((i) => i.confidence),
    [0.9, 0.6, 0.3],
  );
});

test('rankSuggestions preserves extra fields on each item', () => {
  const items = [{ confidence: 0.2, label: 'a' }, { confidence: 0.8, label: 'b' }];
  const ranked = rankSuggestions(items);
  assert.equal(ranked[0].label, 'b');
});

test('rankSuggestions does not mutate the input array', () => {
  const items = [{ confidence: 0.1 }, { confidence: 0.9 }];
  const original = [...items];
  rankSuggestions(items);
  assert.deepEqual(items, original);
});

test('rankSuggestions handles an empty list', () => {
  assert.deepEqual(rankSuggestions([]), []);
});
