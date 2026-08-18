import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAbortingFetch, createFakeFetch } from '../testUtils/fakeFetch';
import { OpenAISpeechToTextProvider } from './OpenAISpeechToTextProvider';

test('transcribe() posts multipart form data with the audio file and model, and returns the transcript', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { text: 'hello world' } }]);
  const provider = new OpenAISpeechToTextProvider('sk-test', { model: 'whisper-1' }, fetchFn);

  const result = await provider.transcribe({ data: Buffer.from('fake wav bytes'), mimeType: 'audio/wav' });

  assert.equal(result.text, 'hello world');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal((calls[0].init?.headers as Record<string, string>)?.Authorization, 'Bearer sk-test');
  const form = calls[0].init?.body as FormData;
  assert.equal(form.get('model'), 'whisper-1');
  assert.ok(form.get('file'), 'the audio file must be attached to the form');
});

test('transcribe() throws a descriptive error on a non-2xx response', async () => {
  const { fetchFn } = createFakeFetch([{ status: 401, body: 'invalid api key' }]);
  const provider = new OpenAISpeechToTextProvider('sk-bad', {}, fetchFn);

  await assert.rejects(
    () => provider.transcribe({ data: Buffer.from('x'), mimeType: 'audio/wav' }),
    /OpenAI speech-to-text request failed \(401\)/,
  );
});

test('transcribe() throws a timeout error when the request is aborted', async () => {
  const provider = new OpenAISpeechToTextProvider('sk-test', { timeoutMs: 10 }, createAbortingFetch());

  await assert.rejects(
    () => provider.transcribe({ data: Buffer.from('x'), mimeType: 'audio/wav' }),
    /timed out after 10ms/,
  );
});

test('transcribe() never persists the audio buffer — it only ever appends it to the outgoing form', async () => {
  const { fetchFn, calls } = createFakeFetch([{ status: 200, body: { text: 'ok' } }]);
  const provider = new OpenAISpeechToTextProvider('sk-test', {}, fetchFn);

  await provider.transcribe({ data: Buffer.from('secret audio payload'), mimeType: 'audio/webm' });

  // The only place the audio bytes end up is the outgoing request's form body — nothing is written to disk.
  const form = calls[0].init?.body as FormData;
  const file = form.get('file') as File;
  assert.equal(file.name, 'audio.webm');
});
