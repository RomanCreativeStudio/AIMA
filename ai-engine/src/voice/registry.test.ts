import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeechToTextProvider,
  createSpeechToTextProviderFromEnv,
  createTextToSpeechProvider,
  createTextToSpeechProviderFromEnv,
} from './registry';

test('createSpeechToTextProvider("mock") returns the mock provider', () => {
  const provider = createSpeechToTextProvider('mock');
  assert.equal(provider.name, 'mock');
});

test('createTextToSpeechProvider("mock") returns the mock provider', () => {
  const provider = createTextToSpeechProvider('mock');
  assert.equal(provider.name, 'mock');
});

test('createSpeechToTextProviderFromEnv() defaults to mock when unset', () => {
  const provider = createSpeechToTextProviderFromEnv({});
  assert.equal(provider.name, 'mock');
});

test('createTextToSpeechProviderFromEnv() defaults to mock when unset', () => {
  const provider = createTextToSpeechProviderFromEnv({});
  assert.equal(provider.name, 'mock');
});
