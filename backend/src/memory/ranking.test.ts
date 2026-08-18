import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRelevanceScore, rankMemories, type MemoryRankingInput } from './ranking';

test('computeRelevanceScore blends similarity, importance, and confidence by their fixed weights', () => {
  const score = computeRelevanceScore({ similarity: 1, importanceScore: 1, confidenceScore: 1 });
  assert.ok(Math.abs(score - 1) < 1e-9);

  const zero = computeRelevanceScore({ similarity: 0, importanceScore: 0, confidenceScore: 0 });
  assert.equal(zero, 0);
});

test('computeRelevanceScore weighs similarity most heavily', () => {
  const highSimilarity = computeRelevanceScore({ similarity: 1, importanceScore: 0, confidenceScore: 0 });
  const highImportance = computeRelevanceScore({ similarity: 0, importanceScore: 1, confidenceScore: 0 });
  const highConfidence = computeRelevanceScore({ similarity: 0, importanceScore: 0, confidenceScore: 1 });

  assert.ok(highSimilarity > highImportance);
  assert.ok(highImportance > highConfidence);
});

test('rankMemories() sorts candidates by relevanceScore, highest first', () => {
  const low: MemoryRankingInput = { similarity: 0.1, importanceScore: 0.1, confidenceScore: 0.1 };
  const high: MemoryRankingInput = { similarity: 0.9, importanceScore: 0.9, confidenceScore: 0.9 };
  const mid: MemoryRankingInput = { similarity: 0.5, importanceScore: 0.5, confidenceScore: 0.5 };

  const ranked = rankMemories([low, mid, high]);

  assert.deepEqual(
    ranked.map((r) => r.relevanceScore),
    [...ranked.map((r) => r.relevanceScore)].sort((a, b) => b - a),
  );
  assert.equal(ranked[0].similarity, 0.9);
  assert.equal(ranked[ranked.length - 1].similarity, 0.1);
});

test('rankMemories() preserves extra fields on each candidate alongside relevanceScore', () => {
  const candidates = [{ id: 'a', similarity: 0.2, importanceScore: 0.2, confidenceScore: 0.2 }];
  const [ranked] = rankMemories(candidates);
  assert.equal(ranked.id, 'a');
  assert.equal(typeof ranked.relevanceScore, 'number');
});

test('rankMemories() handles an empty list', () => {
  assert.deepEqual(rankMemories([]), []);
});
