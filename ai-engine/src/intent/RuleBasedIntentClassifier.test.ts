import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedIntentClassifier } from './RuleBasedIntentClassifier';
import { INTENTS } from './types';

const classifier = new RuleBasedIntentClassifier();

test('classifies "remember" intent', async () => {
  const result = await classifier.classify('Remember that the client prefers email over calls.');
  assert.equal(result.intent, 'remember');
  assert.ok(result.confidence > 0.5);
});

test('classifies "create_task" intent', async () => {
  const result = await classifier.classify('Remind me to follow up with Acme on Friday.');
  assert.equal(result.intent, 'create_task');
});

test('classifies "draft_email" intent', async () => {
  const result = await classifier.classify('Can you draft an email to the client about the delay?');
  assert.equal(result.intent, 'draft_email');
});

test('classifies "summarize" intent', async () => {
  const result = await classifier.classify('Summarize the last three messages for me.');
  assert.equal(result.intent, 'summarize');
});

test('classifies "search_memory" intent', async () => {
  const result = await classifier.classify('Do you remember what the client said about the timeline?');
  assert.equal(result.intent, 'search_memory');
});

test('falls back to "chat" for ordinary conversation', async () => {
  const result = await classifier.classify('What do you think about the new logo direction?');
  assert.equal(result.intent, 'chat');
  assert.ok(result.confidence > 0);
});

test('returns "unknown" for empty or whitespace-only input', async () => {
  const empty = await classifier.classify('');
  const whitespace = await classifier.classify('   ');
  assert.equal(empty.intent, 'unknown');
  assert.equal(whitespace.intent, 'unknown');
  assert.equal(empty.confidence, 0);
});

test('every possible result intent is one of the declared INTENTS', async () => {
  const samples = [
    'Remember that the client prefers email.',
    'Add a task to call the client.',
    'Draft an email to the team.',
    'Summarize this thread.',
    'Do you remember our last conversation?',
    'How is the weather today?',
    '',
  ];

  for (const sample of samples) {
    const result = await classifier.classify(sample);
    assert.ok((INTENTS as readonly string[]).includes(result.intent), `unexpected intent: ${result.intent}`);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});
