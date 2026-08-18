import type { SynthesisResult, TextToSpeechOptions, TextToSpeechProvider } from './types';

/**
 * Deterministic, no-network text-to-speech provider — the default for local
 * development and tests, same role as MockEmbeddingProvider/
 * MockSpeechToTextProvider. Encodes the response text itself as the "audio"
 * payload (a plain UTF-8 buffer, mimeType "text/plain") rather than
 * synthesizing real audio, so the pipeline is fully testable without a paid
 * provider — a real vendor implementation is a drop-in `TextToSpeechProvider`
 * later, no call-site changes.
 */
export class MockTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'mock';

  async synthesize(text: string, _options?: TextToSpeechOptions): Promise<SynthesisResult> {
    return {
      audio: Buffer.from(text, 'utf-8'),
      mimeType: 'text/plain',
    };
  }
}
