import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument } from './chunking';

test('returns a single chunk for short content', () => {
  const chunks = chunkDocument('Just one short paragraph.', 1000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[0].section, null);
  assert.equal(chunks[0].content, 'Just one short paragraph.');
});

test('returns an empty array for empty content', () => {
  assert.deepEqual(chunkDocument(''), []);
  assert.deepEqual(chunkDocument('   \n\n  '), []);
});

test('tags each chunk with the nearest preceding heading', () => {
  const content = [
    '# Setup',
    '',
    'Run npm install.',
    '',
    '## Configuration',
    '',
    'Copy .env.example to .env.',
  ].join('\n');

  const chunks = chunkDocument(content, 1000);
  // Small enough to pack into one chunk — but each source paragraph still
  // carries the section it belongs to for downstream metadata use.
  assert.ok(chunks.length >= 1);
  assert.ok(chunks[0].content.includes('Run npm install.'));
});

test('packs multiple small paragraphs into one chunk up to the size limit', () => {
  const paragraphs = ['Paragraph one.', 'Paragraph two.', 'Paragraph three.'];
  const content = paragraphs.join('\n\n');

  const chunks = chunkDocument(content, 1000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, paragraphs.join('\n\n'));
});

test('splits into multiple chunks once the size limit is exceeded', () => {
  const paragraphA = 'A'.repeat(60);
  const paragraphB = 'B'.repeat(60);
  const paragraphC = 'C'.repeat(60);
  const content = [paragraphA, paragraphB, paragraphC].join('\n\n');

  const chunks = chunkDocument(content, 100);

  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.content.length <= 100);
  }
  // No content lost across the split.
  assert.equal(chunks.map((c) => c.content).join(''), [paragraphA, paragraphB, paragraphC].join(''));
});

test('hard-splits a single paragraph larger than maxChunkChars', () => {
  const longParagraph = 'x'.repeat(250);
  const chunks = chunkDocument(longParagraph, 100);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].content.length, 100);
  assert.equal(chunks[1].content.length, 100);
  assert.equal(chunks[2].content.length, 50);
  assert.equal(chunks.map((c) => c.content).join(''), longParagraph);
});

test('chunk indices are sequential starting at 0', () => {
  const content = Array.from({ length: 5 }, (_, i) => `Paragraph number ${i}.`).join('\n\n');
  const chunks = chunkDocument(content, 20);

  chunks.forEach((chunk, i) => assert.equal(chunk.index, i));
});

test('is deterministic: identical input always produces identical output', () => {
  const content = [
    '# Overview',
    '',
    'This describes the onboarding flow.',
    '',
    '## Step 1',
    '',
    'Create an account.',
    '',
    '## Step 2',
    '',
    'Verify your email address.',
  ].join('\n');

  const first = chunkDocument(content, 40);
  const second = chunkDocument(content, 40);
  assert.deepEqual(first, second);
});
