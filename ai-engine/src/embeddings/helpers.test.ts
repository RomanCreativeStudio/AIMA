import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmbeddingProvider } from './MockEmbeddingProvider';
import { dimensions, embedBatch, embedText, modelName } from './helpers';

test('embedText returns a single vector matching the provider dimensions', async () => {
  const provider = new MockEmbeddingProvider(16);
  const vector = await embedText(provider, 'hello world');
  assert.equal(vector.length, 16);
});

test('embedText is deterministic for the same input', async () => {
  const provider = new MockEmbeddingProvider(16);
  const a = await embedText(provider, 'the quick brown fox');
  const b = await embedText(provider, 'the quick brown fox');
  assert.deepEqual(a, b);
});

test('embedBatch returns one vector per input, matching provider.embed()', async () => {
  const provider = new MockEmbeddingProvider(16);
  const batch = await embedBatch(provider, ['a', 'b', 'c']);
  const direct = await provider.embed(['a', 'b', 'c']);
  assert.equal(batch.length, 3);
  assert.deepEqual(batch, direct);
});

test('modelName returns the provider name', () => {
  const provider = new MockEmbeddingProvider();
  assert.equal(modelName(provider), provider.name);
});

test('dimensions returns the provider dimensions', () => {
  const provider = new MockEmbeddingProvider(32);
  assert.equal(dimensions(provider), 32);
});
