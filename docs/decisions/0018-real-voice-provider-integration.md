# ADR 0018: Real Voice Provider Integration

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/decisions/0017-voice-assistant-foundation.md`, `ai-engine/src/voice/`, `backend/src/voice/`, `backend/src/health/`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Phase 3.2 built the Voice Assistant Foundation's provider abstraction with `mock` as the only implementation — a deliberate scope cut, since that phase asked only for the interfaces. Phase 3.3 asks for a real provider behind those same interfaces, replacing nothing structurally: the safety boundaries Phase 3.2 established (no audio persistence, explicit session control, no wake word, workspace isolation, unmodified `ConversationService`/approval behavior) must hold identically whether the configured provider is `mock` or a live vendor.

## Decisions

### 1. OpenAI's Whisper/TTS REST APIs are the first real provider, called directly via `fetch`

`OpenAISpeechToTextProvider`/`OpenAITextToSpeechProvider` (`ai-engine/src/voice/`) call `https://api.openai.com/v1/audio/transcriptions` and `.../audio/speech` directly, the same "one endpoint doesn't need a whole SDK" reasoning as `OpenAIEmbeddingProvider` and the Phase 2.7 live connectors. OpenAI was the natural first vendor since `ai-engine` already depends on it for embeddings — no new vendor relationship, just a new endpoint pair.

### 2. Both real providers take an injectable `fetch`, a configurable timeout, and a `fakeFetch` test double — mirroring the Phase 2.7 live-connector pattern exactly

`ai-engine/src/testUtils/fakeFetch.ts` (a near-identical port of `backend/src/testUtils/fakeFetch.ts`, extended with an `isBinary` option for the TTS provider's raw MP3 response) lets every provider test run without a live network call. Each provider wraps its `fetch` call in an `AbortController` with a default 30-second timeout (`timeoutMs` constructor option), throwing a descriptive "timed out after Nms" error on abort — the explicit "Timeout handling" requirement — rather than letting a hung request block a voice turn indefinitely.

### 3. `SpeechToTextProviderConfig`/`TextToSpeechProviderConfig` replace the old bare-string parameter — additive, since only internal callers existed

Phase 3.2's `createSpeechToTextProvider(provider: SupportedSpeechToTextProvider)` took just a provider name; Phase 3.3 widens this to a config object (`{ provider, apiKey?, model?, timeoutMs? }`), since a real vendor needs credentials the `mock` provider never did. This is a breaking signature change, but grep confirmed the only callers were `ai-engine`'s own `index.ts` re-export and its own tests — no `backend/` call site constructs a provider directly (it only ever calls `createSpeechToTextProviderFromEnv()`), so nothing outside `ai-engine` needed updating. The env-var names (`SPEECH_TO_TEXT_PROVIDER_API_KEY`/`_MODEL`/`_TIMEOUT_MS`, mirrored for TTS) follow the same `{PROVIDER}_API_KEY`/`_MODEL` convention `EMBEDDING_PROVIDER_API_KEY`/`_MODEL` already established.

### 4. `VoiceProviderError` wraps every provider failure with a generic message — the vendor's raw error body never reaches an HTTP response

`backend/src/voice/errors.ts`'s new `VoiceProviderError` (`operation: 'speech-to-text' | 'text-to-speech'`, real error preserved via the standard `Error.cause`) is what `VoiceService.submitVoiceRequest` throws when either provider call fails, and `routes/voice.ts` maps it to `502` with only the generic message. A malformed API key, a vendor outage, or a malformed request all surface identically to the client — enough to show "voice provider unavailable," never enough to leak a vendor's raw response text (which could echo back request details). This is a stricter version of the existing `createErrorHandler`'s "never leak internals" posture (`docs/decisions/0016-production-deployment-foundation.md`), applied specifically at the voice layer because a vendor's error body is more likely to contain something worth redacting than this codebase's own exceptions are.

### 5. `HealthService` gains a `voiceProviders` check — configuration-only, no live vendor call, same reasoning as `aiProvider`/`integrations`

The new check reports the configured provider names (e.g. `"openai / openai"`) computed from the real provider instances constructed in `index.ts`, not a raw env re-check — consistent with how the Phase 3.1 `integrations` check works. It stays deliberately shallow: provider construction already fails fast at startup if a non-`mock` provider is selected without an API key (`ai-engine/src/voice/registry.ts` throws immediately), so by the time `HealthService.check()` runs, the configured provider is already known-valid — there is nothing a live call to the vendor would tell a health poll that startup didn't already guarantee, and a network round-trip to a third party on every poll remains the wrong tradeoff (`docs/decisions/0006-assistant-core-orchestration.md`).

### 6. `VoiceSessionViewModel` fetches provider status via the existing health endpoint rather than a new one

`loadProviderStatus()` calls the existing `GET /health` and reads `checks.voiceProviders` — no new backend route, since the Dashboard already exposes this exact data for the same reason (a plain configuration display, not a live check). `isProviderError`, set only when a `submitVoiceRequest` failure carries HTTP 502, lets the macOS `VoiceView` show a distinct "voice provider unavailable" state instead of a generic error message, satisfying this phase's "better error states" item without introducing a new error-classification scheme beyond the status code the backend already returns.

### 7. No change to what gets persisted, what requires approval, or how workspace isolation is enforced

`VoiceService.submitVoiceRequest`'s shape is unchanged from Phase 3.2: transcribe → `ConversationService.sendMessage` (unmodified) → synthesize → persist `voice_turns` (transcript + response text only, still no audio column). Swapping `mock` for `openai` changes only which class implements `SpeechToTextProvider`/`TextToSpeechProvider` — every workspace-isolation check, every approval-evaluation call, and the "no audio persistence" invariant are exactly the code Phase 3.2 wrote, untouched.

## Consequences

- `ai-engine`'s test suite grew from 28 tests (Phase 3.2) to 42, adding `OpenAISpeechToTextProvider.test.ts`/`OpenAITextToSpeechProvider.test.ts` (multipart form construction, JSON body construction, non-2xx errors, timeouts, and a direct assertion that the outgoing audio buffer is never anything but the attached form field) and extending `registry.test.ts` for the `openai` config path.
- `backend/`'s test suite grew from 504 tests (Phase 3.2's regression) to 509: two `VoiceProviderError`-wrapping tests in `voiceService.test.ts`, one 502-mapping route test, and two `HealthService.checkVoiceProviders` tests.
- `apps/Shared/AIMACore`'s test suite grew from 151 tests to 154: `SystemHealth`'s new `voiceProviders` field (model decoding + `URLSessionAPIClient` fixture), and two `VoiceSessionViewModel` tests (`loadProviderStatus`, `isProviderError` set/cleared across a failing-then-succeeding turn) using a new `MockAPIClient.forceNextVoiceRequestToFailWithProviderError()` test hook.
- The macOS app's module boundary was re-verified the same way ADR 0009/0017 established: `swift build` inside `apps/macos` fails only on `no such module 'SwiftUI'`, confirming the new provider-status row and error-state branch in `VoiceView.swift` introduce no other compile error.
- `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` now support `"openai"` in addition to `"mock"`; `"mock"` remains the default and fully supported for local development and every existing test, per this phase's explicit "mock provider remains available for tests" requirement.
- No audio is persisted anywhere in this phase's changes; no wake word, background/always-listening capture, or autonomous multi-turn conversation was added; no approval-evaluation or workspace-isolation code path was touched. A real vendor account's API key is the only new prerequisite for `openai` mode — nothing in this phase requires one to exist, since `mock` is still the default.
