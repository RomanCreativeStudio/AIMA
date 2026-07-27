import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedIntentClassifier } from './RuleBasedIntentClassifier';
import { INTENTS } from './types';

const classifier = new RuleBasedIntentClassifier();

test('classifies "remember" intent and extracts its content parameter', async () => {
  const result = await classifier.classify('Remember that the client prefers email over calls.');
  assert.equal(result.intent, 'remember');
  assert.ok(result.confidence > 0.5);
  assert.equal(result.parameters.content, 'the client prefers email over calls');
});

test('classifies "create_task" intent and extracts its title parameter', async () => {
  const result = await classifier.classify('Remind me to follow up with Acme on Friday.');
  assert.equal(result.intent, 'create_task');
  assert.equal(result.parameters.title, 'follow up with Acme on Friday'.toLowerCase());
});

test('classifies "draft_email" intent and extracts its topic parameter', async () => {
  const result = await classifier.classify('Can you draft an email to the client about the delay?');
  assert.equal(result.intent, 'draft_email');
  assert.equal(result.parameters.topic, 'the delay');
});

test('classifies "draft_proposal" intent and extracts its topic parameter', async () => {
  const result = await classifier.classify('Please draft a proposal for the Acme website redesign.');
  assert.equal(result.intent, 'draft_proposal');
  assert.equal(result.parameters.topic, 'the acme website redesign');
});

test('classifies "summarize" intent and extracts its subject parameter', async () => {
  const result = await classifier.classify('Summarize the last three messages for me.');
  assert.equal(result.intent, 'summarize');
  assert.equal(result.parameters.subject, 'the last three messages for me');
});

test('classifies "search_memory" intent and extracts its query parameter', async () => {
  const result = await classifier.classify('Do you remember what the client said about the timeline?');
  assert.equal(result.intent, 'search_memory');
  assert.equal(result.parameters.query, 'what the client said about the timeline');
});

test('classifies "search_documents" intent and extracts its query parameter', async () => {
  const result = await classifier.classify('Search the docs for the onboarding checklist.');
  assert.equal(result.intent, 'search_documents');
  assert.equal(result.parameters.query, 'the onboarding checklist');
});

test('falls back to "chat" for ordinary conversation with no parameters', async () => {
  const result = await classifier.classify('What do you think about the new logo direction?');
  assert.equal(result.intent, 'chat');
  assert.ok(result.confidence > 0);
  assert.deepEqual(result.parameters, {});
});

test('returns "unknown" for empty or whitespace-only input', async () => {
  const empty = await classifier.classify('');
  const whitespace = await classifier.classify('   ');
  assert.equal(empty.intent, 'unknown');
  assert.equal(whitespace.intent, 'unknown');
  assert.equal(empty.confidence, 0);
  assert.deepEqual(empty.parameters, {});
});

test('every possible result intent is one of the declared INTENTS, and parameters is always an object', async () => {
  const samples = [
    'Remember that the client prefers email.',
    'Add a task to call the client.',
    'Draft an email to the team.',
    'Draft a proposal for the new contract.',
    'Summarize this thread.',
    'Do you remember our last conversation?',
    'Search the documents for the style guide.',
    'How is the weather today?',
    '',
  ];

  for (const sample of samples) {
    const result = await classifier.classify(sample);
    assert.ok((INTENTS as readonly string[]).includes(result.intent), `unexpected intent: ${result.intent}`);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.equal(typeof result.parameters, 'object');
  }
});
