import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from './MockEmbeddingProvider';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // both vectors are already unit-normalized
}

test('MockEmbeddingProvider returns a vector of the configured dimensionality', async () => {
  const provider = new MockEmbeddingProvider(64);
  const [embedding] = await provider.embed(['hello world']);
  assert.equal(embedding.length, 64);
});

test('MockEmbeddingProvider is deterministic for the same input', async () => {
  const provider = new MockEmbeddingProvider(128);
  const [a] = await provider.embed(['the client prefers email']);
  const [b] = await provider.embed(['the client prefers email']);
  assert.deepEqual(a, b);
});

test('MockEmbeddingProvider produces closer vectors for texts sharing words', async () => {
  const provider = new MockEmbeddingProvider(256);
  const [base] = await provider.embed(['the client wants a website redesign']);
  const [related] = await provider.embed(['redesign the client website']);
  const [unrelated] = await provider.embed(['character backstory for the fracture protocol']);

  const relatedScore = cosineSimilarity(base, related);
  const unrelatedScore = cosineSimilarity(base, unrelated);

  assert.ok(
    relatedScore > unrelatedScore,
    `expected shared-word text (${relatedScore}) to score higher than unrelated text (${unrelatedScore})`,
  );
});

test('MockEmbeddingProvider embeds a batch in input order', async () => {
  const provider = new MockEmbeddingProvider(32);
  const [a, b] = await provider.embed(['first text', 'second text']);
  const [aAgain] = await provider.embed(['first text']);
  assert.deepEqual(a, aAgain);
  assert.notDeepEqual(a, b);
});
