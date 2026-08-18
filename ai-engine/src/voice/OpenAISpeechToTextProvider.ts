import type { AudioInput, SpeechToTextProvider, TranscriptionResult } from './types';

const DEFAULT_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 30_000;
const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface OpenAISpeechToTextProviderOptions {
  model?: string;
  timeoutMs?: number;
}

interface OpenAITranscriptionResponse {
  text: string;
}

/**
 * Calls OpenAI's Whisper transcription endpoint directly via `fetch` rather
 * than a full SDK — mirrors `OpenAIEmbeddingProvider`'s "one endpoint
 * doesn't need a whole SDK" precedent (`ai-engine/src/embeddings/
 * OpenAIEmbeddingProvider.ts`) and the live connectors' injectable-`fetch`
 * pattern (Phase 2.7, `docs/decisions/0015-live-integration-providers.md`),
 * so this repo's test suite never makes a real network call
 * (docs/decisions/0018-real-voice-provider-integration.md).
 *
 * The audio buffer this provider receives is held only in memory for the
 * duration of this call — nothing here writes it to disk or logs it,
 * preserving `VoiceService`'s "no audio persistence" invariant (Phase 3.2).
 */
export class OpenAISpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'openai';

  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: OpenAISpeechToTextProviderOptions = {},
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append('file', new Blob([audio.data], { type: audio.mimeType }), `audio${extensionFor(audio.mimeType)}`);
    form.append('model', this.model);

    const response = await this.request(form);
    if (!response.ok) {
      throw new Error(`OpenAI speech-to-text request failed (${response.status}): ${await response.text()}`);
    }

    const body = (await response.json()) as OpenAITranscriptionResponse;
    // Whisper's default (non-verbose) JSON response reports no confidence score.
    return { text: body.text };
  }

  private async request(form: FormData): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI speech-to-text request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`OpenAI speech-to-text request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('ogg')) return '.ogg';
  return '.wav';
}
