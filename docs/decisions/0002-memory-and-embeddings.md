# ADR 0002: Memory Scope Model and Embedding Provider

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §4, `docs/PRODUCT_BIBLE.md` §3 & §6, `database/migrations/0002_memory_scopes.sql`

## Context

The Intelligence Sprint required supporting four memory categories from the Product Bible: user, conversation, project, and workspace memories. It also required storing and retrieving embeddings via pgvector without hardcoding a single embedding provider, mirroring the `AIProvider` abstraction from the Foundation Sprint.

Two open design questions:

1. Does "user memory" imply memory that is visible across workspaces (a global user profile), which would be in tension with the workspace isolation guarantee in `docs/TECHNICAL_ARCHITECTURE.md` §6?
2. Which embedding provider should be the default, given the AI provider (Claude) has no first-party embeddings endpoint?

## Decision

**Memory scope stays workspace-bound.** All four scopes (`user`, `workspace`, `conversation`, `project`) are represented in a single `memory_records` table, and every row — regardless of scope — carries a required `workspace_id`. "User" scope means a durable personal-preference fact recorded *within* a given workspace (e.g., "always draft RCS proposals in a formal tone"), not a memory visible across all workspaces. This keeps the workspace isolation guarantee absolute and avoids building cross-workspace bridging infrastructure before it's needed — bridging remains the explicit, on-request mechanism described in `docs/PRODUCT_BIBLE.md` §6, untouched by this sprint.

"Project" scope uses a lightweight `project_key` text tag rather than a full `projects` relational entity, since no project management feature exists yet to anchor such a table to. This can be normalized into a real table later without changing the `MemoryService` API.

Scope consistency (`conversation` requires `conversation_id`; `project` requires `project_key`) is enforced with a database `CHECK` constraint, not just application code — consistent with treating data integrity rules as structural, not advisory.

**Embedding provider abstraction mirrors `AIProvider`.** `ai-engine/src/embeddings/` defines an `EmbeddingProvider` interface, selected at runtime via `EMBEDDING_PROVIDER` (env var), exactly like `AI_PROVIDER` for chat completions. Two implementations ship:

- **`MockEmbeddingProvider`** (default): a deterministic, no-network "hashing trick" embedding — each word is hashed into a fixed-size bucket, so texts sharing words produce closer vectors than texts that don't. This is not a semantic model, but it gives genuinely meaningful ranking behavior for local development and tests without any API key or cost, and it exercises the exact same pgvector code path a real provider would.
- **`OpenAIEmbeddingProvider`**: calls OpenAI's `text-embedding-3-small` (1536 dimensions — matching the `memory_records.embedding` column) via a direct `fetch` call rather than adding the full `openai` SDK as a dependency, since embeddings is the only endpoint needed.

Claude/Anthropic was not used for embeddings because Anthropic does not offer a first-party embeddings endpoint; OpenAI's is a common, low-friction choice that matches the column dimension already chosen as a placeholder in `0001_init.sql`.

## Consequences

- Every memory query remains a single-workspace query — no code path needs to reason about cross-workspace memory leakage.
- Swapping embedding providers (or adding a third, e.g. Voyage AI) requires one new file and one `switch` case in `ai-engine/src/embeddings/registry.ts`, matching the `AIProvider` pattern.
- Because `MockEmbeddingProvider` produces real (if crude) similarity signal, the retrieval pipeline (ranking, scope filtering, workspace isolation) is fully testable without ever calling a paid API — see `backend/src/memory/memoryService.test.ts`.
- If a future feature needs true cross-workspace recall (e.g., "what do I know about this person across all my work"), that is a new, explicit decision — not an emergent side effect of how "user" scope was modeled here.
