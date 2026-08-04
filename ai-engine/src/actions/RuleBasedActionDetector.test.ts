import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedActionDetector } from './RuleBasedActionDetector';

test('detect() finds a todo from "I need to ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('I need to send the invoice tomorrow.');

  assert.equal(candidate.category, 'todo');
  assert.match(candidate.content, /^I need to send the invoice tomorrow/i);
  assert.match(candidate.reason, /i need to/i);
});

test('detect() finds a todo from "todo: ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Todo: draft the Q3 proposal.');

  assert.equal(candidate.category, 'todo');
  assert.match(candidate.reason, /todo:/i);
});

test('detect() finds a follow-up from "follow up on ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Follow up on the Acme contract next week.');

  assert.equal(candidate.category, 'follow_up');
  assert.match(candidate.content, /^Follow up on the Acme contract next week/i);
});

test('detect() finds a follow-up from "circle back ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Circle back with the client on Monday.');

  assert.equal(candidate.category, 'follow_up');
  assert.match(candidate.reason, /circle back/i);
});

test('detect() finds a meeting from "schedule a meeting ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect("Let's schedule a meeting with the design team.");

  assert.equal(candidate.category, 'meeting');
  assert.match(candidate.reason, /schedule a meeting/i);
});

test('detect() finds a meeting from "let\'s meet ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect("Let's meet Thursday afternoon.");

  assert.equal(candidate.category, 'meeting');
  assert.match(candidate.reason, /let's meet/i);
});

test('detect() finds a blocked item from "blocked on ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Blocked on the design review before I can ship.');

  assert.equal(candidate.category, 'blocked');
  assert.match(candidate.content, /^Blocked on the design review/i);
});

test('detect() finds a blocked item from "stuck on ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Stuck on the API integration.');

  assert.equal(candidate.category, 'blocked');
  assert.match(candidate.reason, /stuck on/i);
});

test('detect() finds a postponed item from "postponing ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Postponing the launch until next quarter.');

  assert.equal(candidate.category, 'postponed');
  assert.match(candidate.content, /^Postponing the launch until next quarter/i);
});

test('detect() finds a postponed item from "push back ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Push back the proposal deadline.');

  assert.equal(candidate.category, 'postponed');
  assert.match(candidate.reason, /push back/i);
});

test('detect() finds a delegated item from "delegated ... to ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Delegated the client follow-up to Sam.');

  assert.equal(candidate.category, 'delegated');
  assert.match(candidate.content, /^Delegated the client follow-up to Sam/i);
});

test('detect() finds a delegated item from "hand off ..."', () => {
  const detector = new RuleBasedActionDetector();
  const [candidate] = detector.detect('Handing off the onboarding doc.');

  assert.equal(candidate.category, 'delegated');
  assert.match(candidate.reason, /hand off/i);
});

test('detect() returns nothing for ordinary conversational text', () => {
  const detector = new RuleBasedActionDetector();
  const candidates = detector.detect('What time is the meeting tomorrow?');

  assert.deepEqual(candidates, []);
});

test('detect() finds multiple distinct candidates from one message', () => {
  const detector = new RuleBasedActionDetector();
  const candidates = detector.detect('I need to email the client. Follow up on the invoice too.');

  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((c) => c.category === 'todo'));
  assert.ok(candidates.some((c) => c.category === 'follow_up'));
});

test('detect() every candidate reports a confidence within [0, 1] and a non-empty reason', () => {
  const detector = new RuleBasedActionDetector();
  const candidates = detector.detect(
    'I need to send the invoice. Follow up on the proposal. Let\'s schedule a meeting for Friday.',
  );

  assert.ok(candidates.length >= 3);
  for (const candidate of candidates) {
    assert.ok(candidate.confidence >= 0 && candidate.confidence <= 1);
    assert.ok(candidate.reason.length > 0);
  }
});
