import type { SynthesisResult, TextToSpeechOptions, TextToSpeechProvider } from './types';

const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_TIMEOUT_MS = 30_000;
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

export interface OpenAITextToSpeechProviderOptions {
  model?: string;
  timeoutMs?: number;
}

/**
 * Calls OpenAI's speech-synthesis endpoint directly via `fetch` — same
 * injectable-`fetch`, no-live-network-call-in-tests pattern as
 * `OpenAISpeechToTextProvider`. Returns raw MP3 bytes; `VoiceService` never
 * writes them to disk — it returns them to the caller once, for a single
 * explicit, user-triggered playback (Phase 3.2's "no persistent audio
 * storage" invariant, unchanged this phase).
 */
export class OpenAITextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'openai';

  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: OpenAITextToSpeechProviderOptions = {},
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async synthesize(text: string, options: TextToSpeechOptions = {}): Promise<SynthesisResult> {
    const response = await this.request(text, options);
    if (!response.ok) {
      throw new Error(`OpenAI text-to-speech request failed (${response.status}): ${await response.text()}`);
    }

    return { audio: Buffer.from(await response.arrayBuffer()), mimeType: 'audio/mpeg' };
  }

  private async request(text: string, options: TextToSpeechOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(SPEECH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          voice: options.voice ?? DEFAULT_VOICE,
          input: text,
          speed: options.speakingRate,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI text-to-speech request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`OpenAI text-to-speech request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
