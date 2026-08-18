# ADR 0021: Semantic Search & Context Retrieval

**Status:** Decided
**Date:** 2026-07-29
**Relates to:** `docs/decisions/0005-knowledge-ingestion.md`, `docs/decisions/0019-advanced-memory-system.md`, `docs/decisions/0020-proactive-intelligence.md`, `database/migrations/0019_embeddings.sql`, `ai-engine/src/embeddings/`, `backend/src/embeddings/`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Phase 1.2 gave memories their own embedding column and ranked search (`MemoryService`); Phase 1.5 gave imported documents the same via `document_chunks`. Neither conversations nor tasks have ever been embedded or semantically searchable — a user could not ask "what have we discussed about the Acme redesign" and get back relevant past turns, nor find a task by describing it rather than titling it exactly. Phase 3.6 closes that gap: a generic embedding store for content types that don't already have one, ranked similarity search across it, and an advisory "retrieved context" attached to chat responses — retrieval only, explicitly never automatic memory creation, automatic execution, or anything feeding back into what the AI actually generates.

## Decisions

### 1. A new, generic `embeddings` table — deliberately not a migration of `memory_records`/`document_chunks`

`database/migrations/0019_embeddings.sql` adds `embedding_models` (one row per provider/model pair actually used) and `embeddings` (workspace-scoped chunks: `source_type`, `source_id`, `chunk_index`, `content`, `content_hash`, `embedding_model_id`, `embedding_version`, `indexed_at`). `memory_records.embedding` and `document_chunks.embedding` are untouched — they already have first-class, well-tested embedding columns and retrieval paths (`MemoryService.search`, `DocumentService.search`); duplicating their data into the new table would be pure risk for no functional gain. The new table exclusively covers what those two don't: conversations and tasks are actively indexed this phase; `note` and `document` are forward-compatible enum placeholders (no Notes feature and no generic document type exist yet) that need no future migration once they do.

### 2. `source_id` is not a foreign key — workspace isolation is enforced via the denormalized `workspace_id` column, not the FK graph

`source_type` names which table `source_id` points into (`conversations`, `tasks`, ...), and no single `REFERENCES` target can satisfy every source type a `CHECK`/enum could name. Every `EmbeddingService`/`RetrievalService` query filters explicitly by `workspace_id` — the same pattern `document_chunks`/`memory_records` already established — so isolation doesn't depend on the FK relationship existing.

### 3. `content_hash` (sha256) is the concrete mechanism behind "update changed vectors"

`EmbeddingService.indexContent` chunks the incoming content, hashes each chunk, and compares against the stored hash for that `(workspace_id, source_type, source_id, chunk_index)` — only chunks whose hash actually changed get re-embedded (a real call to `EmbeddingProvider.embed()`) and re-upserted; unchanged chunks are skipped entirely, and chunks that no longer exist because the source shrank are deleted. This is the same "re-embed only what changed" intent `DocumentService.reindexDocument` already had for documents, generalized to any indexable source.

### 4. ai-engine keeps its existing `EmbeddingProvider`/registry unchanged; the phase's requested `embedText`/`embedBatch`/`dimensions`/`modelName` shape is added as free-function wrappers

The phase asks for an `EmbeddingProvider` interface with `embedText()`/`embedBatch()`/`dimensions()`/`modelName()` methods and a `ProviderRegistry`. `ai-engine/src/embeddings/` already has a fully-built, heavily-consumed `EmbeddingProvider` (`name`/`dimensions` properties, batch `embed(texts)` method), `MockEmbeddingProvider`, `OpenAIEmbeddingProvider`, and an environment-driven registry (`createEmbeddingProvider`/`createEmbeddingProviderFromEnv`) — consumed by `MemoryService`, `DocumentService`, `ConversationIntelligenceService`, `ProactiveIntelligenceService`, and now `EmbeddingService`/`RetrievalService`. Rewriting the interface to match the literal request would ripple through every one of those consumers and their tests for no functional gain. Instead, `ai-engine/src/embeddings/helpers.ts` adds `embedText(provider, text)`, `embedBatch(provider, texts)`, `modelName(provider)`, `dimensions(provider)` as thin free functions over the existing shape — satisfying the literal ask functionally without touching the interface or registry. This is the same "extend, don't rename" call Phase 3.4 made for `MemoryRecord`/`RankedMemoryResult`.

### 5. `RetrievalService` depends on `db: Queryable` directly for conversations/tasks, never on `ConversationService`/`TaskService` — avoiding a circular dependency

`ConversationService` needs `RetrievalService` (to attach `retrievedContext` to `SendMessageResult`). If `RetrievalService` needed `ConversationService` back (to read a conversation's messages), the two would form a cycle. `RetrievalService.reindexWorkspace`/`buildConversationContent` instead run raw SQL against `conversations`/`messages`/`tasks` directly — it already needs direct DB access for the `embeddings` table itself, so this isn't a new kind of dependency, just extended to the two source tables it walks.

### 6. A conversation's indexable content is a deterministic concatenation of its recent messages — never an AI-generated summary

`RetrievalService.buildConversationContent` fetches the conversation's most recent messages (bounded by `CONVERSATION_CONTENT_MESSAGE_LIMIT`) via direct SQL and joins them as `"role: content"` lines, oldest-first — the same shape `ConversationService.listMessages` already produces, just read independently to avoid the circular dependency above. This keeps indexing "deterministic behavior where required": the same conversation state always produces the same indexed content, and no AI provider is ever called from anywhere in `backend/src/embeddings/` — only the injected `EmbeddingProvider` abstraction.

### 7. `retrievedContext` is attached to `SendMessageResult` as pure advisory metadata — never wired into the AI prompt itself

`ConversationService.sendMessage` computes `retrievedContext` via `RetrievalService.getContext()` (merging `MemoryService.getWorkspaceContext`, and `RetrievalService.search` filtered to `conversation`/`task` source types) and attaches it to the response, but `AimaCoreService`/`ContextManager`'s existing prompt-assembly pipeline is untouched — `retrievedContext` plays no part in what the AI actually generates. This mirrors the established "advisory field, never actually affects generation" pattern `workflowSuggestion`/`executionSuggestion`/`memorySuggestions` already set, and avoids destabilizing the already-solid, heavily-tested core generation path for a phase whose objective is explicitly "retrieval only."

### 8. `retrievalService` is an optional trailing dependency on `ConversationServiceDependencies` and an optional field on `AppDependencies` — the same no-test-ripple pattern as `memoryExtractor`/`proactiveIntelligenceService`

`retrievalService?: RetrievalService` defaults to `undefined`, and `SendMessageResult.retrievedContext` is simply `null` when it's absent — none of the ~15 existing test files that construct `ConversationService`/`createApp` without knowing about retrieval needed to change. `app.ts` only mounts `retrievalRouter` when `retrievalService` is present, following Phase 3.5's `proactiveIntelligenceService` precedent exactly.

### 9. All three retrieval routes are explicitly permission-gated — unlike the precedent `memories.ts`/`documents.ts` set for their own read routes

`memories.ts`'s `/search` and `/context` GET routes, and `documents.ts`'s `/search` GET route, are unauthenticated-but-workspace-scoped reads with no `PermissionEngine.evaluate` call. This phase's task list explicitly requires "permission-gated" for all three retrieval routes, so `GET .../retrieval/search` and `GET .../retrieval/context` are gated behind a new `semantic_search` capability (Tier 1/`suggest`, mirroring `suggest_followup`'s tier — read-only, no draft or execution) and `POST .../retrieval/reindex` behind a new `reindex_embeddings` capability (Tier 2/`prepare`, mirroring `reindex_document`'s exact tier), each returning the `PermissionDecision` in its response body the way `documents.ts`'s mutating routes already do. This is a deliberate departure from the read-route precedent, made because the phase spelled out the requirement explicitly where it hadn't for memories/documents.

### 10. AIMACore adds genuinely new models (`EmbeddingRecord`, `SearchResult`, `RetrievedContext`, `IndexResult`, `ReindexWorkspaceResult`) mirroring the backend's shapes exactly, and extends `SendMessageResult` the same backward-compatible way Phase 3.4/3.5 did

`SearchResult` mirrors `RankedEmbeddingResult` the same way `RankedMemoryResult` already duplicates `MemoryRecord`'s fields rather than composing it (the backend's `mapRow` spreads the score into the same flat JSON object). `SendMessageResult.retrievedContext` decodes via a custom `init(from:)` that `decodeIfPresent`s the key and defaults to `nil` — a pre-Phase-3.6 payload (or a backend with no `RetrievalService` configured) still decodes exactly as it did before. A new `SearchViewModel` backs manual search/context/reindex; `ChatViewModel` gains `lastRetrievedContext` (set from each reply, cleared on `selectConversation` alongside the other per-turn advisory fields) and `WorkspaceViewModel` gains `reindexEmbeddings()`/`lastReindexResult` (cleared on `switchWorkspace`) — both explicit-only, never auto-fetched, the same "no automatic actions" rule `loadConversationIntelligence`/`loadWorkspaceSuggestions` already follow.

### 11. macOS's Search screen and Chat's context panel are plain, read-only, inline content — no automatic popup, no background retrieval UI

The Search screen (`Views/Search/SearchView.swift`) only fetches on an explicit "Search"/"Show Context"/"Re-index Workspace" button tap — nothing runs as the user types, and nothing polls in the background. Chat's `RetrievedContextCardView` renders whatever `retrievedContext` came back attached to the most recent reply — the same data the response already carried, not a separate fetch — following the exact visual language (inline card, appears only when non-nil) `ConversationIntelligenceCardView`/`RecommendationsCardView` already established, so "no automatic popup" is a structural property of the view rather than a rule someone has to remember.

## Consequences

- `ai-engine`'s test suite grew from 66 tests (Phase 3.5) to 71: a new `embeddings/helpers.test.ts` covering `embedText`/`embedBatch`/`modelName`/`dimensions`.
- `backend/`'s test suite grew from 570 tests (Phase 3.5) to 604: a new `embeddings/` module (`chunkingService.test.ts`, `embeddingService.test.ts` — indexing, content-hash change detection, stale-chunk deletion, workspace isolation — `retrievalService.test.ts` — similarity ranking, source-type filtering, workspace isolation, `getContext` merging, `reindexWorkspace` idempotency — and `embeddings.migration.test.ts` — unique constraints, cascade delete, enum values, column defaults), two new `conversationService.test.ts` cases (`retrievedContext` present when a `RetrievalService` is configured and never writes anything; `null` when absent), and a new `routes/retrieval.test.ts` (all three routes, permission gating, validation, 404 mapping, cross-workspace isolation).
- `apps/Shared/AIMACore`'s test suite grew from 189 tests (Phase 3.5) to 208: new `SearchViewModelTests`, extended `ChatViewModelTests`/`WorkspaceViewModelTests`/`URLSessionAPIClientTests`, and new `ModelDecodingTests` cases for `SearchResult`/`RetrievedContext`/`ReindexWorkspaceResult`/the extended `SendMessageResult`.
- The macOS app's module boundary was re-verified the same way ADR 0009/0017/0018/0019/0020 established: `swift build` inside `apps/macos` fails only on `no such module 'SwiftUI'`, confirming the new Search screen and Chat's retrieved-context card introduce no other compile error.
- No autonomous behavior was added: nothing in `EmbeddingService`/`RetrievalService` creates a memory, sends a message, executes a workflow/execution, or runs without an explicit caller. `reindexWorkspace` only runs when a user (or the reindex route) explicitly triggers it — never on a schedule, never in the background.
- No automatic memory creation: this phase never writes to `memory_records`; `RetrievalService.getContext` only reads via `MemoryService.getWorkspaceContext`.
- Workspace isolation and the existing approval system are both unchanged — every new query filters by `workspace_id` explicitly, and the two new capabilities (`semantic_search`, `reindex_embeddings`) are registered with tiers and evaluated through the same `PermissionEngine`/`ActionLogger` every other capability uses.
