/**
 * Voice Assistant Foundation (Phase 3.2): provider abstractions for speech
 * recognition and speech synthesis, mirroring the AIProvider/EmbeddingProvider
 * pattern (docs/TECHNICAL_ARCHITECTURE.md §4) — nothing outside
 * ai-engine/src/voice may depend on a specific vendor's SDK or API shape.
 */
export interface AudioInput {
  /** Raw encoded audio bytes — never assumed to be a specific codec. */
  data: Buffer;
  /** e.g. "audio/wav", "audio/webm". */
  mimeType: string;
  sampleRateHz?: number;
}

export interface TranscriptionResult {
  text: string;
  /** 0-1, when the provider reports one. */
  confidence?: number;
  language?: string;
}

/**
 * Every speech-to-text provider AIMA can use implements this interface.
 */
export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audio: AudioInput): Promise<TranscriptionResult>;
}

export interface TextToSpeechOptions {
  voice?: string;
  speakingRate?: number;
}

export interface SynthesisResult {
  audio: Buffer;
  mimeType: string;
}

/**
 * Every text-to-speech provider AIMA can use implements this interface.
 */
export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(text: string, options?: TextToSpeechOptions): Promise<SynthesisResult>;
}
