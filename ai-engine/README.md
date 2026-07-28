# ai-engine

AIMA's AI orchestration layer. Owns all communication with LLM providers so that no other part of the system (clients or `backend/`) ever depends on a specific provider's SDK or API shape.

## Scope of this package

- **`src/types.ts`** — provider-agnostic request/response shapes (`AIProvider`, `AICompletionRequest`, `AICompletionResult`).
- **`src/providers/`** — one file per concrete provider implementation. Currently: `ClaudeProvider` (Anthropic) and `MockProvider` (no network, deterministic — the local development default).
- **`src/registry.ts`** — the only place that selects a concrete provider, driven by the `AI_PROVIDER` environment variable. Nothing else in the codebase should import a provider class directly.
- **`src/embeddings/`** — the same abstraction pattern for embeddings: `EmbeddingProvider` interface, `MockEmbeddingProvider` (deterministic, no network — the local development default) and `OpenAIEmbeddingProvider`, selected via `EMBEDDING_PROVIDER` through `src/embeddings/registry.ts`. Used by `backend/`'s memory service (docs/TECHNICAL_ARCHITECTURE.md §4) to embed and retrieve memory records.
- **`src/intent/`** — the same abstraction pattern again, for structured intent detection: `IntentClassifier` interface, `RuleBasedIntentClassifier` (pattern matching, no AI call — the only implementation today). Used by `backend/src/intent/intentEngine.ts` to classify a conversation turn into one of a fixed set of intents (docs/decisions/0004-intent-and-approval-engine.md). No registry/env-var selection layer yet, since there's only one implementation to select between.
- **`src/voice/`** — the Voice Assistant Foundation's provider abstraction (Phase 3.2, docs/decisions/0017-voice-assistant-foundation.md): `SpeechToTextProvider`/`TextToSpeechProvider` interfaces, each with a deterministic `Mock*` implementation (no vendor account, no network — decodes/encodes plain UTF-8 text as the "audio" payload) selected via `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` through `src/voice/registry.ts`. "mock" is the only supported value today — a real vendor is a drop-in later.

Context assembly (blending retrieved memory into an AI request's system prompt) is implemented in `backend/src/conversation/contextAssembly.ts`, not in this package — it's a pure function over data this package's `EmbeddingProvider`/`MemoryService` retrieval already produced, so it didn't need to live alongside the provider abstractions themselves.

## Adding a new provider

1. Implement the `AIProvider`, `EmbeddingProvider`, or `IntentClassifier` interface in a new file under `src/providers/`, `src/embeddings/`, or `src/intent/`.
2. Add one case to the `switch` in the matching `registry.ts` (skip this for `IntentClassifier` until a second implementation exists — see `src/intent/`'s note above).
3. No other file needs to change — callers only ever construct a provider via `createAIProviderFromEnv()` / `createEmbeddingProviderFromEnv()` (or, for intent, construct `RuleBasedIntentClassifier` directly).

## Configuration

See `.env.example`. `AI_PROVIDER`, `EMBEDDING_PROVIDER`, `SPEECH_TO_TEXT_PROVIDER`, and `TEXT_TO_SPEECH_PROVIDER` all default to `mock` so the rest of the system is runnable without any API key. `RuleBasedIntentClassifier` needs no configuration.

## Tests

`npm test` runs `node:test` via `tsx` — no test framework dependency beyond that. Embedding/intent provider tests are pure unit tests (no network, no database). The glob in `package.json`'s `test` script is deliberately quoted (`'src/**/*.test.ts'`) — `/bin/sh` on Debian/Ubuntu is `dash`, which doesn't support bash's `**` recursive globstar, so an unquoted pattern would silently skip test files nested more than one directory deep.
