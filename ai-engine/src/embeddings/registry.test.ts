import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingProvider, createEmbeddingProviderFromEnv } from './registry';

test('createEmbeddingProvider returns MockEmbeddingProvider for "mock"', () => {
  const provider = createEmbeddingProvider({ provider: 'mock' });
  assert.equal(provider.name, 'mock');
});

test('createEmbeddingProvider throws for "openai" without an API key', () => {
  assert.throws(() => createEmbeddingProvider({ provider: 'openai' }), /EMBEDDING_PROVIDER_API_KEY/);
});

test('createEmbeddingProvider returns OpenAIEmbeddingProvider given an API key', () => {
  const provider = createEmbeddingProvider({ provider: 'openai', apiKey: 'test-key' });
  assert.equal(provider.name, 'openai');
});

test('createEmbeddingProviderFromEnv defaults to mock when EMBEDDING_PROVIDER is unset', () => {
  const provider = createEmbeddingProviderFromEnv({});
  assert.equal(provider.name, 'mock');
});

test('createEmbeddingProviderFromEnv reads EMBEDDING_PROVIDER from the given env', () => {
  const provider = createEmbeddingProviderFromEnv({
    EMBEDDING_PROVIDER: 'openai',
    EMBEDDING_PROVIDER_API_KEY: 'test-key',
  } as NodeJS.ProcessEnv);
  assert.equal(provider.name, 'openai');
});
