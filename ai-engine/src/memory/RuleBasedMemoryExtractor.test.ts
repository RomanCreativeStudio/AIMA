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

test('extract() detects a completed task from "I\'ve finished ..."', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract("I've finished the onboarding redesign.");

  assert.equal(candidate.category, 'completed_task');
  assert.match(candidate.content, /^I've finished the onboarding redesign/i);
  assert.match(candidate.reason, /finished\/completed/i);
});

test('extract() detects a completed task from "done with ..."', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract('I am done with the client proposal.');

  assert.equal(candidate.category, 'completed_task');
  assert.match(candidate.reason, /done with/i);
});

test('extract() detects a decision from "decided to ..."', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract("We've decided to ship the beta on Friday.");

  assert.equal(candidate.category, 'decision');
  assert.match(candidate.content, /^We've decided to ship the beta on Friday/i);
  assert.match(candidate.reason, /decided to\/that/i);
});

test('extract() detects a decision from "let\'s go with ..."', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract("Let's go with the blue color scheme.");

  assert.equal(candidate.category, 'decision');
  assert.match(candidate.reason, /let's go with/i);
});

test('extract() detects a reminder from "remind me to ..."', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract('Remind me to send the invoice tomorrow.');

  assert.equal(candidate.category, 'reminder');
  assert.match(candidate.content, /^Remind me to send the invoice tomorrow/i);
  assert.match(candidate.reason, /remind me to/i);
});

test('extract() detects a project update from "project update: ..."', () => {
  const extractor = new RuleBasedMemoryExtractor();
  const [candidate] = extractor.extract('Project update: the migration is 80% complete.');

  assert.equal(candidate.category, 'project_update');
  assert.match(candidate.reason, /project\/status update/i);
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
