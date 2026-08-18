import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockTextToSpeechProvider } from './MockTextToSpeechProvider';

test('synthesize() encodes the text as a UTF-8 buffer', async () => {
  const provider = new MockTextToSpeechProvider();
  const result = await provider.synthesize('hello there');

  assert.equal(result.audio.toString('utf-8'), 'hello there');
  assert.equal(result.mimeType, 'text/plain');
});

test('synthesize() ignores options without erroring', async () => {
  const provider = new MockTextToSpeechProvider();
  const result = await provider.synthesize('hi', { voice: 'alloy', speakingRate: 1.2 });

  assert.equal(result.audio.toString('utf-8'), 'hi');
});
