export type {
  AIMessage,
  AIMessageRole,
  AICompletionRequest,
  AICompletionResult,
  AICompletionUsage,
  AIProvider,
} from './types';

export { createAIProvider, createAIProviderFromEnv } from './registry';
export type { ProviderConfig, SupportedProvider } from './registry';

export type { EmbeddingProvider } from './embeddings/types';
export { MockEmbeddingProvider } from './embeddings/MockEmbeddingProvider';
export { OpenAIEmbeddingProvider } from './embeddings/OpenAIEmbeddingProvider';
export { createEmbeddingProvider, createEmbeddingProviderFromEnv } from './embeddings/registry';
export type { EmbeddingProviderConfig, SupportedEmbeddingProvider } from './embeddings/registry';

export { INTENTS } from './intent/types';
export type { Intent, IntentClassifier, IntentDetectionResult } from './intent/types';
export { RuleBasedIntentClassifier } from './intent/RuleBasedIntentClassifier';

export type {
  AudioInput,
  TranscriptionResult,
  SpeechToTextProvider,
  TextToSpeechOptions,
  SynthesisResult,
  TextToSpeechProvider,
} from './voice/types';
export { MockSpeechToTextProvider } from './voice/MockSpeechToTextProvider';
export { MockTextToSpeechProvider } from './voice/MockTextToSpeechProvider';
export {
  createSpeechToTextProvider,
  createSpeechToTextProviderFromEnv,
  createTextToSpeechProvider,
  createTextToSpeechProviderFromEnv,
} from './voice/registry';
export type { SupportedSpeechToTextProvider, SupportedTextToSpeechProvider } from './voice/registry';
