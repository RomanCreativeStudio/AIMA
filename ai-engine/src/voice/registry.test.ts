import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeechToTextProvider,
  createSpeechToTextProviderFromEnv,
  createTextToSpeechProvider,
  createTextToSpeechProviderFromEnv,
} from './registry';

test('createSpeechToTextProvider({provider: "mock"}) returns the mock provider', () => {
  const provider = createSpeechToTextProvider({ provider: 'mock' });
  assert.equal(provider.name, 'mock');
});

test('createTextToSpeechProvider({provider: "mock"}) returns the mock provider', () => {
  const provider = createTextToSpeechProvider({ provider: 'mock' });
  assert.equal(provider.name, 'mock');
});

test('createSpeechToTextProvider({provider: "openai"}) returns the OpenAI provider given an apiKey', () => {
  const provider = createSpeechToTextProvider({ provider: 'openai', apiKey: 'sk-test' });
  assert.equal(provider.name, 'openai');
});

test('createSpeechToTextProvider({provider: "openai"}) throws without an apiKey', () => {
  assert.throws(() => createSpeechToTextProvider({ provider: 'openai' }), /SPEECH_TO_TEXT_PROVIDER_API_KEY is required/);
});

test('createTextToSpeechProvider({provider: "openai"}) returns the OpenAI provider given an apiKey', () => {
  const provider = createTextToSpeechProvider({ provider: 'openai', apiKey: 'sk-test' });
  assert.equal(provider.name, 'openai');
});

test('createTextToSpeechProvider({provider: "openai"}) throws without an apiKey', () => {
  assert.throws(() => createTextToSpeechProvider({ provider: 'openai' }), /TEXT_TO_SPEECH_PROVIDER_API_KEY is required/);
});

test('createSpeechToTextProviderFromEnv() defaults to mock when unset', () => {
  const provider = createSpeechToTextProviderFromEnv({});
  assert.equal(provider.name, 'mock');
});

test('createTextToSpeechProviderFromEnv() defaults to mock when unset', () => {
  const provider = createTextToSpeechProviderFromEnv({});
  assert.equal(provider.name, 'mock');
});

test('createSpeechToTextProviderFromEnv() selects openai and reads its api key from env', () => {
  const provider = createSpeechToTextProviderFromEnv({
    SPEECH_TO_TEXT_PROVIDER: 'openai',
    SPEECH_TO_TEXT_PROVIDER_API_KEY: 'sk-test',
  });
  assert.equal(provider.name, 'openai');
});

test('createTextToSpeechProviderFromEnv() selects openai and reads its api key from env', () => {
  const provider = createTextToSpeechProviderFromEnv({
    TEXT_TO_SPEECH_PROVIDER: 'openai',
    TEXT_TO_SPEECH_PROVIDER_API_KEY: 'sk-test',
  });
  assert.equal(provider.name, 'openai');
});
