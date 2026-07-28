import type { SpeechToTextProvider, TextToSpeechProvider } from './types';
import { MockSpeechToTextProvider } from './MockSpeechToTextProvider';
import { MockTextToSpeechProvider } from './MockTextToSpeechProvider';

export type SupportedSpeechToTextProvider = 'mock';
export type SupportedTextToSpeechProvider = 'mock';

/**
 * The only place in the codebase allowed to know which concrete
 * SpeechToTextProvider/TextToSpeechProvider classes exist — mirrors
 * ../registry.ts (AIProvider) and ../embeddings/registry.ts
 * (EmbeddingProvider). "mock" is the only supported value today; a real
 * vendor (e.g. "whisper", "elevenlabs") is added here later without any
 * caller needing to change.
 */
export function createSpeechToTextProvider(provider: SupportedSpeechToTextProvider): SpeechToTextProvider {
  switch (provider) {
    case 'mock':
      return new MockSpeechToTextProvider();
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown speech-to-text provider: ${exhaustiveCheck}`);
    }
  }
}

export function createTextToSpeechProvider(provider: SupportedTextToSpeechProvider): TextToSpeechProvider {
  switch (provider) {
    case 'mock':
      return new MockTextToSpeechProvider();
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown text-to-speech provider: ${exhaustiveCheck}`);
    }
  }
}

/** Reads SPEECH_TO_TEXT_PROVIDER from process.env, defaulting to "mock". */
export function createSpeechToTextProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SpeechToTextProvider {
  const provider = (env.SPEECH_TO_TEXT_PROVIDER ?? 'mock') as SupportedSpeechToTextProvider;
  return createSpeechToTextProvider(provider);
}

/** Reads TEXT_TO_SPEECH_PROVIDER from process.env, defaulting to "mock". */
export function createTextToSpeechProviderFromEnv(env: NodeJS.ProcessEnv = process.env): TextToSpeechProvider {
  const provider = (env.TEXT_TO_SPEECH_PROVIDER ?? 'mock') as SupportedTextToSpeechProvider;
  return createTextToSpeechProvider(provider);
}
