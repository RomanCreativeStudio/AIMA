import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSpeechToTextProvider } from './MockSpeechToTextProvider';

test('transcribe() returns the audio buffer decoded as UTF-8 text', async () => {
  const provider = new MockSpeechToTextProvider();
  const result = await provider.transcribe({ data: Buffer.from('hello world', 'utf-8'), mimeType: 'audio/wav' });

  assert.equal(result.text, 'hello world');
  assert.equal(result.confidence, 1);
});

test('transcribe() reports zero confidence for empty audio', async () => {
  const provider = new MockSpeechToTextProvider();
  const result = await provider.transcribe({ data: Buffer.from('', 'utf-8'), mimeType: 'audio/wav' });

  assert.equal(result.text, '');
  assert.equal(result.confidence, 0);
});

test('transcribe() trims surrounding whitespace', async () => {
  const provider = new MockSpeechToTextProvider();
  const result = await provider.transcribe({ data: Buffer.from('  padded  ', 'utf-8'), mimeType: 'audio/wav' });

  assert.equal(result.text, 'padded');
});
