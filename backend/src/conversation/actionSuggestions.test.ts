import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionCandidate, MemoryCandidate } from '@aima/ai-engine';
import { buildActionSuggestions } from './actionSuggestions';

function actionCandidate(overrides: Partial<ActionCandidate> = {}): ActionCandidate {
  return { content: 'Follow up on the Acme contract', category: 'follow_up', confidence: 0.8, reason: 'test', ...overrides };
}

function memoryCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    content: 'Remind me to send the invoice',
    category: 'reminder',
    importance: 0.8,
    confidence: 0.9,
    reason: 'test',
    ...overrides,
  };
}

test('buildActionSuggestions maps ActionCandidates through unchanged', () => {
  const suggestions = buildActionSuggestions([actionCandidate({ category: 'todo', content: 'I need to email the client' })], []);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].category, 'todo');
  assert.equal(suggestions[0].content, 'I need to email the client');
});

test('buildActionSuggestions folds in reminder/decision memory candidates', () => {
  const suggestions = buildActionSuggestions(
    [],
    [
      memoryCandidate({ category: 'reminder', content: 'Remind me to send the invoice' }),
      memoryCandidate({ category: 'decision', content: "We've decided to ship on Friday" }),
      memoryCandidate({ category: 'fact', content: 'My name is Roman' }),
      memoryCandidate({ category: 'preference', content: 'I prefer email' }),
    ],
  );

  assert.equal(suggestions.length, 2, 'only reminder/decision memory candidates become action suggestions');
  assert.ok(suggestions.some((s) => s.category === 'reminder'));
  assert.ok(suggestions.some((s) => s.category === 'decision'));
});

test('buildActionSuggestions deduplicates identical content across the two sources', () => {
  const suggestions = buildActionSuggestions(
    [actionCandidate({ category: 'todo', content: 'Send the invoice' })],
    [memoryCandidate({ category: 'reminder', content: 'send the invoice' })],
  );

  assert.equal(suggestions.length, 1, 'the same phrase reported by two independent sources should only appear once');
  assert.equal(suggestions[0].category, 'todo', 'first match wins');
});

test('buildActionSuggestions returns an empty array when nothing was detected', () => {
  assert.deepEqual(buildActionSuggestions([], []), []);
});
