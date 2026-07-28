# ADR 0017: Voice Assistant Foundation

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §2, §4, `ai-engine/src/voice/`, `backend/src/voice/`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Phase 3.2 asked for the foundation of voice interaction — audio in, transcript, AIMA Core, response, audio out — explicitly without building "full autonomous voice control." Every prior sprint's conversation surface has been text: a typed message through `ConversationService.sendMessage`. The task is to add a second input/output modality (voice) without duplicating any of the orchestration, permission, or approval machinery that modality already relies on, and without introducing background listening, a wake word, or any capability that runs without an explicit user action — the same "no automation without explicit approval" posture the Product Bible has held since the Foundation Sprint, now extended to "no listening without an explicit start."

## Decisions

### 1. `SpeechToTextProvider`/`TextToSpeechProvider` mirror the existing provider-abstraction pattern exactly

`ai-engine/src/voice/types.ts` defines two minimal interfaces (`transcribe(audio) -> TranscriptionResult`, `synthesize(text, options?) -> SynthesisResult`), with `MockSpeechToTextProvider`/`MockTextToSpeechProvider` as the only implementations and a `registry.ts` selecting between them via `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` (both default `mock`). This is the same shape as `AIProvider`/`EmbeddingProvider`/`OAuthProvider` — callers depend only on the interface. Unlike Phase 2.7's OAuth providers, which implemented real vendor REST calls against a fake `fetch` in tests, this phase's task explicitly asked only for the *interfaces*, not a live vendor integration — so the mock implementations here are the only implementations, full stop, not a test-only stand-in for a real one that also exists. Registering a real vendor (e.g. a cloud STT/TTS API) is later-phase scope and needs no change to any call site, only a new `registry.ts` case.

### 2. The mock providers decode/encode plain UTF-8 text, not synthesized audio

`MockSpeechToTextProvider.transcribe` treats the audio buffer's UTF-8 content as the transcript; `MockTextToSpeechProvider.synthesize` encodes the reply text back into a buffer (`mimeType: "text/plain"`). This mirrors `MockEmbeddingProvider`'s role — a deterministic, no-network stand-in that lets the full pipeline (session lifecycle, transcript processing, response generation) be built and tested without a paid vendor or any audio-codec handling this environment has no way to verify. The macOS Voice UI's composer (Decision 6) exploits this directly: it sends a typed utterance's UTF-8 bytes as the "audio," which the mock provider decodes right back to the original text.

### 3. A voice session is a thin wrapper around a real conversation, not a parallel pipeline

`VoiceService.startSession` calls the unmodified `ConversationService.createConversation` and stores the resulting `conversationId` on a new `voice_sessions` row (`database/migrations/0016_voice.sql`). `submitVoiceRequest` transcribes the caller's audio, then calls the unmodified `ConversationService.sendMessage` with the transcript as the message content — meaning context assembly, intent detection, capability-to-approval routing, workflow/execution suggestions, and action logging all apply to a voice turn exactly as they do to a typed one, with zero duplicated logic. This is the same "push new behavior behind an existing seam" approach ADR 0015 used for OAuth token refresh and ADR 0012 used for approval-gating a workflow step: the capability was already correct, only a new caller needed to reach it.

### 4. No audio is ever persisted — only transcript text and response text

`voice_turns` has no audio-bytes column at all; `VoiceService.submitVoiceRequest` holds the audio `Buffer` only in memory for the duration of the transcribe/synthesize call. This is the phase's explicit "no audio persistence by default" security requirement, enforced structurally (there is no column to write to) rather than by a policy someone could forget to apply — the same reasoning the Product Bible applies to permission tiers: make the unsafe thing structurally impossible, not just documented against. A backend test (`voiceService.test.ts`) asserts directly against `information_schema.columns` that no column on `voice_turns` even mentions "audio."

### 5. Session lifecycle is explicit start/end, with no automatic transitions

`voice_sessions.status` is `active`/`ended` only — there is no `expired`/timeout-based transition, and nothing in the codebase ends a session except a caller's explicit `POST .../voice/sessions/:id/end`. `submitVoiceRequest` and `endSession` both reject (409, `InvalidVoiceSessionStateError`) against a session that's already `ended`, mirroring `InvalidWorkflowStateError`'s "operation invalid from this state" shape. This is the mechanism behind the phase's "user control required to start sessions" and "no background listening" requirements: a session existing at all is proof a human explicitly started it, and it stays open only as long as no one has explicitly closed it — there is no polling, timer, or background job anywhere in this feature.

### 6. Audio travels as base64 in a JSON body — no new transport mechanism

`POST .../voice/sessions/:id/turns` accepts `{ audioBase64, audioMimeType, configuration? }` and returns `{ turn, audioBase64, audioMimeType, ... }`, the same JSON-over-HTTP shape every other route in this API already uses, rather than introducing multipart form data, a WebSocket, or a streaming upload — none of which any other part of this codebase uses either. This keeps the Voice Assistant Foundation additive: no new middleware, no new content-type handling in `app.ts`. On macOS, real microphone capture (`AVAudioEngine`) is deliberately not built this phase — a build/test environment with no macOS runtime has no way to verify audio-recording code actually works, so `VoiceView`'s composer instead encodes a typed utterance as UTF-8 bytes, which the mock `SpeechToTextProvider` (Decision 2) decodes back to the original text. Swapping in real capture later only changes what produces the `Data` passed to `submitVoiceRequest` — the session lifecycle, transcript display, and playback-state UI don't change.

### 7. `VoicePlaybackState` is a pure state flag — this view model never plays audio itself

`VoiceSessionViewModel` exposes `playbackState: .idle | .playing | .finished` and `markPlaybackStarted()`/`markPlaybackFinished()`, but contains no `AVAudioPlayer` or any platform audio API — the same reason `apps/Shared/AIMACore` has no SwiftUI/Combine dependency (docs/decisions/0009-macos-experience-foundation.md): it must stay buildable and testable on Linux. The macOS `VoiceView` calls these two methods around wherever it eventually adds real playback; today it just flips the state immediately, since there's no synthesized audio worth actually playing against the mock TTS provider.

## Consequences

- `backend/`'s test suite grew from 484 tests (Phase 3.1's regression) to 504, adding `voiceService.test.ts` (session lifecycle, isolation, no-audio-persistence, transcript/response pipeline against a real `ConversationService`) and `routes/voice.test.ts` (HTTP-level coverage of every route, including the 409 double-end and workspace-isolation cases). `ai-engine`'s own suite grew from 19 to 28 tests, covering the two mock providers and the registry's env-based selection.
- `apps/Shared/AIMACore`'s test suite grew from 134 tests to 151, covering model decoding (`VoiceSession`, `VoiceResponse`'s base64 audio decoding), `URLSessionAPIClient`'s six new methods, and `VoiceSessionViewModel`'s full lifecycle against `MockAPIClient`.
- The macOS app's module boundary was re-verified the same way ADR 0009 established: `swift build` inside `apps/macos` fails only on `error: no such module 'SwiftUI'` for every file including the new `VoiceView.swift`, confirming no other compile error is hiding behind the platform mismatch.
- No live vendor speech-to-text or text-to-speech integration exists — `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` support only `"mock"` today. No wake word, background/always-listening audio capture, or autonomous multi-turn voice conversation exists or is implied by this phase — every voice turn requires an explicit client call with already-captured audio, and every session requires an explicit start/end call.
