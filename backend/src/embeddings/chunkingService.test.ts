import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkingService } from './chunkingService';

test('chunk splits long content into multiple chunks bounded by maxChunkChars', () => {
  const service = new ChunkingService();
  const paragraph = 'word '.repeat(400).trim();

  const chunks = service.chunk(paragraph, 200);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 200);
  }
});

test('chunk is deterministic for the same content and maxChunkChars', () => {
  const service = new ChunkingService();
  const content = '# Section\n\nFirst paragraph.\n\nSecond paragraph that is a bit longer than the first one.';

  const a = service.chunk(content, 50);
  const b = service.chunk(content, 50);

  assert.deepEqual(a, b);
});

test('chunk returns the whole content as one chunk when it fits within maxChunkChars', () => {
  const service = new ChunkingService();
  const content = 'Short content.';

  const chunks = service.chunk(content, 1000);

  assert.deepEqual(chunks, ['Short content.']);
});

test('chunk returns no chunks for empty content', () => {
  const service = new ChunkingService();
  assert.deepEqual(service.chunk('', 1000), []);
});
