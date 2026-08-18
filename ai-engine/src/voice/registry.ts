import type { SpeechToTextProvider, TextToSpeechProvider } from './types';
import { MockSpeechToTextProvider } from './MockSpeechToTextProvider';
import { MockTextToSpeechProvider } from './MockTextToSpeechProvider';
import { OpenAISpeechToTextProvider } from './OpenAISpeechToTextProvider';
import { OpenAITextToSpeechProvider } from './OpenAITextToSpeechProvider';

export type SupportedSpeechToTextProvider = 'mock' | 'openai';
export type SupportedTextToSpeechProvider = 'mock' | 'openai';

export interface SpeechToTextProviderConfig {
  provider: SupportedSpeechToTextProvider;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface TextToSpeechProviderConfig {
  provider: SupportedTextToSpeechProvider;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * The only place in the codebase allowed to know which concrete
 * SpeechToTextProvider classes exist — mirrors ../registry.ts (AIProvider)
 * and ../embeddings/registry.ts (EmbeddingProvider). "mock" remains
 * available deliberately (item: "Mock provider remains available for
 * tests") — it's the local-development default and every existing test
 * keeps using it, never a live network call.
 */
export function createSpeechToTextProvider(config: SpeechToTextProviderConfig): SpeechToTextProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('SPEECH_TO_TEXT_PROVIDER_API_KEY is required when SPEECH_TO_TEXT_PROVIDER=openai');
      }
      return new OpenAISpeechToTextProvider(config.apiKey, { model: config.model, timeoutMs: config.timeoutMs });
    case 'mock':
      return new MockSpeechToTextProvider();
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown speech-to-text provider: ${exhaustiveCheck}`);
    }
  }
}

export function createTextToSpeechProvider(config: TextToSpeechProviderConfig): TextToSpeechProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('TEXT_TO_SPEECH_PROVIDER_API_KEY is required when TEXT_TO_SPEECH_PROVIDER=openai');
      }
      return new OpenAITextToSpeechProvider(config.apiKey, { model: config.model, timeoutMs: config.timeoutMs });
    case 'mock':
      return new MockTextToSpeechProvider();
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown text-to-speech provider: ${exhaustiveCheck}`);
    }
  }
}

/** Reads SPEECH_TO_TEXT_PROVIDER(_API_KEY|_MODEL|_TIMEOUT_MS) from process.env, defaulting to "mock". */
export function createSpeechToTextProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SpeechToTextProvider {
  const provider = (env.SPEECH_TO_TEXT_PROVIDER ?? 'mock') as SupportedSpeechToTextProvider;
  return createSpeechToTextProvider({
    provider,
    apiKey: env.SPEECH_TO_TEXT_PROVIDER_API_KEY,
    model: env.SPEECH_TO_TEXT_PROVIDER_MODEL,
    timeoutMs: env.SPEECH_TO_TEXT_PROVIDER_TIMEOUT_MS ? Number(env.SPEECH_TO_TEXT_PROVIDER_TIMEOUT_MS) : undefined,
  });
}

/** Reads TEXT_TO_SPEECH_PROVIDER(_API_KEY|_MODEL|_TIMEOUT_MS) from process.env, defaulting to "mock". */
export function createTextToSpeechProviderFromEnv(env: NodeJS.ProcessEnv = process.env): TextToSpeechProvider {
  const provider = (env.TEXT_TO_SPEECH_PROVIDER ?? 'mock') as SupportedTextToSpeechProvider;
  return createTextToSpeechProvider({
    provider,
    apiKey: env.TEXT_TO_SPEECH_PROVIDER_API_KEY,
    model: env.TEXT_TO_SPEECH_PROVIDER_MODEL,
    timeoutMs: env.TEXT_TO_SPEECH_PROVIDER_TIMEOUT_MS ? Number(env.TEXT_TO_SPEECH_PROVIDER_TIMEOUT_MS) : undefined,
  });
}
