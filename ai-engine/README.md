# ai-engine

AIMA's AI orchestration layer. Owns all communication with LLM providers so that no other part of the system (clients or `backend/`) ever depends on a specific provider's SDK or API shape.

## Scope of this package

- **`src/types.ts`** — provider-agnostic request/response shapes (`AIProvider`, `AICompletionRequest`, `AICompletionResult`).
- **`src/providers/`** — one file per concrete provider implementation. Currently: `ClaudeProvider` (Anthropic) and `MockProvider` (no network, deterministic — the local development default).
- **`src/registry.ts`** — the only place that selects a concrete provider, driven by the `AI_PROVIDER` environment variable. Nothing else in the codebase should import a provider class directly.

Memory, context assembly, and knowledge retrieval (RAG) — described in `docs/TECHNICAL_ARCHITECTURE.md` §4 — are **not yet implemented**. They are scoped to the Intelligence Sprint (`docs/TECHNICAL_ARCHITECTURE.md` §10) and will be added as additional modules in this package once the Foundation Sprint's provider abstraction and backend scaffold are in place.

## Adding a new provider

1. Implement the `AIProvider` interface in a new file under `src/providers/`.
2. Add one case to the `switch` in `src/registry.ts`.
3. No other file needs to change — callers only ever construct a provider via `createAIProviderFromEnv()`.

## Configuration

See `.env.example`. `AI_PROVIDER` defaults to `mock` so the rest of the system is runnable without any API key.
