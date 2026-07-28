import type { AudioInput, SpeechToTextProvider, TranscriptionResult } from './types';

/**
 * Deterministic, no-network speech-to-text provider — the default for local
 * development and tests, same role as MockEmbeddingProvider. Real audio
 * decoding is outside this environment's scope (no vendor account, no live
 * network call); this provider treats the audio buffer's UTF-8 text content
 * as the "transcript" so the full pipeline (session lifecycle, transcript
 * processing, response generation) can be built and tested without a paid
 * provider — a real vendor implementation (e.g. Whisper, a cloud STT API) is
 * a drop-in `SpeechToTextProvider` later, no call-site changes.
 */
export class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'mock';

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const text = audio.data.toString('utf-8').trim();
    return {
      text,
      confidence: text.length > 0 ? 1 : 0,
    };
  }
}
