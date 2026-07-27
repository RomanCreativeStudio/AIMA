# ai-engine

AIMA's AI orchestration layer. Owns all communication with LLM providers so that no other part of the system (clients or `backend/`) ever depends on a specific provider's SDK or API shape.

## Scope of this package

- **`src/types.ts`** — provider-agnostic request/response shapes (`AIProvider`, `AICompletionRequest`, `AICompletionResult`).
- **`src/providers/`** — one file per concrete provider implementation. Currently: `ClaudeProvider` (Anthropic) and `MockProvider` (no network, deterministic — the local development default).
- **`src/registry.ts`** — the only place that selects a concrete provider, driven by the `AI_PROVIDER` environment variable. Nothing else in the codebase should import a provider class directly.
- **`src/embeddings/`** — the same abstraction pattern for embeddings: `EmbeddingProvider` interface, `MockEmbeddingProvider` (deterministic, no network — the local development default) and `OpenAIEmbeddingProvider`, selected via `EMBEDDING_PROVIDER` through `src/embeddings/registry.ts`. Used by `backend/`'s memory service (docs/TECHNICAL_ARCHITECTURE.md §4) to embed and retrieve memory records.

Full context assembly (blending retrieved memory into an AI request's system prompt) is **not yet implemented** — this package currently provides the retrieval building blocks (embeddings) that `backend/src/memory` uses directly. Wiring retrieval into the actual chat/completion request is Integration Sprint scope.

## Adding a new provider

1. Implement the `AIProvider` (or `EmbeddingProvider`) interface in a new file under `src/providers/` (or `src/embeddings/`).
2. Add one case to the `switch` in the matching `registry.ts`.
3. No other file needs to change — callers only ever construct a provider via `createAIProviderFromEnv()` / `createEmbeddingProviderFromEnv()`.

## Configuration

See `.env.example`. `AI_PROVIDER` and `EMBEDDING_PROVIDER` both default to `mock` so the rest of the system is runnable without any API key.

## Tests

`npm test` runs `node:test` via `tsx` — no test framework dependency beyond that. Embedding provider tests are pure unit tests (no network, no database).
