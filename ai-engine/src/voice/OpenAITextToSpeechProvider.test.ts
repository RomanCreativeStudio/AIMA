import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAbortingFetch, createFakeFetch } from '../testUtils/fakeFetch';
import { OpenAITextToSpeechProvider } from './OpenAITextToSpeechProvider';

test('synthesize() posts the text and options as JSON, and returns raw audio bytes', async () => {
  const audioBytes = Buffer.from('fake mp3 bytes');
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: audioBytes, isBinary: true }]);
  const provider = new OpenAITextToSpeechProvider('sk-test', { model: 'tts-1' }, fetchFn);

  const result = await provider.synthesize('hello there', { voice: 'alloy', speakingRate: 1.1 });

  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.audio.toString('utf-8'), 'fake mp3 bytes');

  const sentBody = JSON.parse(calls[0].init?.body as string);
  assert.equal(sentBody.model, 'tts-1');
  assert.equal(sentBody.voice, 'alloy');
  assert.equal(sentBody.input, 'hello there');
  assert.equal(sentBody.speed, 1.1);
});

test('synthesize() defaults to the "alloy" voice when none is specified', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: Buffer.from('x'), isBinary: true }]);
  const provider = new OpenAITextToSpeechProvider('sk-test', {}, fetchFn);

  await provider.synthesize('hi');

  const sentBody = JSON.parse(calls[0].init?.body as string);
  assert.equal(sentBody.voice, 'alloy');
});

test('synthesize() throws a descriptive error on a non-2xx response', async () => {
  const { fetchFn } = createFakeFetch([{ status: 429, body: 'rate limited' }]);
  const provider = new OpenAITextToSpeechProvider('sk-test', {}, fetchFn);

  await assert.rejects(() => provider.synthesize('hi'), /OpenAI text-to-speech request failed \(429\)/);
});

test('synthesize() throws a timeout error when the request is aborted', async () => {
  const provider = new OpenAITextToSpeechProvider('sk-test', { timeoutMs: 10 }, createAbortingFetch());

  await assert.rejects(() => provider.synthesize('hi'), /timed out after 10ms/);
});
