import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedMemoryExtractor } from './RuleBasedMemoryExtractor';

test('extract() detects a "my name is" fact with high confidence and an explanation', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract('My name is Roman and I run a creative studio.');

  assert.equal(candidate.category, 'fact');
  assert.match(candidate.content, /^My name is Roman/i);
  assert.ok(candidate.confidence >= 0.9);
  assert.match(candidate.reason, /my name is/i);
});

test('extract() detects an explicit "remember that" instruction', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract('Remember that the client wants weekly status updates.');

  assert.equal(candidate.category, 'fact');
  assert.match(candidate.reason, /remember that/i);
});

test('extract() detects an "I prefer" preference', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract('I prefer email over phone calls for client communication.');

  assert.equal(candidate.category, 'preference');
  assert.match(candidate.content, /^I prefer email/i);
  assert.match(candidate.reason, /i prefer/i);
});

test('extract() detects multiple candidates from one message', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const candidates = extractor.extract('My name is Roman. I always draft proposals in a formal tone.');

  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((c) => c.category === 'fact'));
  assert.ok(candidates.some((c) => c.category === 'preference'));
});

test('extract() returns nothing for ordinary conversational text', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const candidates = extractor.extract('What time is the meeting tomorrow?');

  assert.deepEqual(candidates, []);
});

test('extract() every candidate reports scores within [0, 1] and a non-empty reason', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const candidates = extractor.extract(
    'My name is Roman. I prefer concise emails. I never work past 6pm. I like long walks. Note that the deploy window is Fridays.',
  );

  assert.ok(candidates.length >= 4);
  for (const candidate of candidates) {
    assert.ok(candidate.importance >= 0 && candidate.importance <= 1);
    assert.ok(candidate.confidence >= 0 && candidate.confidence <= 1);
    assert.ok(candidate.reason.length > 0);
  }
});
