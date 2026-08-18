import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionCandidate, MemoryCandidate } from '@aima/ai-engine';
import type { Task } from '../tasks/types';
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

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    workspaceId: 'ws-1',
    title: 'Design review for the onboarding flow',
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    source: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

test('buildActionSuggestions folds in completed_task memory candidates (Executive Assistant Loop sprint)', () => {
  const suggestions = buildActionSuggestions(
    [],
    [memoryCandidate({ category: 'completed_task', content: "I've finished the client proposal" })],
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].category, 'completed_task');
});

test('buildActionSuggestions maps blocked/postponed/delegated ActionCandidates through unchanged', () => {
  const suggestions = buildActionSuggestions(
    [
      actionCandidate({ category: 'blocked', content: 'Blocked on the design review' }),
      actionCandidate({ category: 'postponed', content: 'Postponing the launch' }),
      actionCandidate({ category: 'delegated', content: 'Delegated the doc to Sam' }),
    ],
    [],
  );

  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((s) => ['blocked', 'postponed', 'delegated'].includes(s.category)));
});

test('buildActionSuggestions resolves matchedTaskId for task-referencing categories via keyword overlap', () => {
  const openTasks = [task({ id: 'match-me', title: 'Design review for the onboarding flow' })];

  const suggestions = buildActionSuggestions(
    [actionCandidate({ category: 'blocked', content: 'Blocked on the design review' })],
    [],
    openTasks,
  );

  assert.equal(suggestions[0].matchedTaskId, 'match-me');
});

test('buildActionSuggestions leaves matchedTaskId null for non-task-referencing categories, and when no open task matches', () => {
  const openTasks = [task({ id: 'unrelated', title: 'Design review for the onboarding flow' })];

  const suggestions = buildActionSuggestions(
    [
      actionCandidate({ category: 'todo', content: 'I need to email the client' }),
      actionCandidate({ category: 'blocked', content: 'Blocked on something totally unconnected' }),
    ],
    [],
    openTasks,
  );

  assert.equal(suggestions.find((s) => s.category === 'todo')!.matchedTaskId, null);
  assert.equal(suggestions.find((s) => s.category === 'blocked')!.matchedTaskId, null);
});

test('buildActionSuggestions defaults matchedTaskId to null when openTasks is omitted (pre-existing call sites keep compiling)', () => {
  const suggestions = buildActionSuggestions(
    [actionCandidate({ category: 'blocked', content: 'Blocked on the design review' })],
    [],
  );

  assert.equal(suggestions[0].matchedTaskId, null);
});
