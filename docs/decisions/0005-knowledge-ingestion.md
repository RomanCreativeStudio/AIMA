# ADR 0005: Knowledge Ingestion Foundation

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3 & §4, `backend/src/knowledge/`, `database/migrations/0004_documents.sql`

## Context

Phase 1.5 asked AIMA to ingest, index, and retrieve project documentation — Markdown, plain text, and (at least as an interface) PDF — alongside the existing memory system, without building UI or external integrations. Several design questions came up.

## Decisions

### 1. Documents are a separate table pair, not another memory scope

`memory_records` already had a `project` scope with a `project_key` tag; it would have been possible to shoehorn ingested documents into it. Instead, `documents` and `document_chunks` are new tables (`0004_documents.sql`). Reasoning: documents have a fundamentally different lifecycle — import, re-index, delete, list — and metadata (format, source, tags, version, a canonical `raw_content`) that memory records don't need and shouldn't carry. Overloading one table for two different concerns would have made both harder to reason about. Both are still workspace-scoped exactly like memory, and `document_chunks` denormalizes `workspace_id` from its parent `documents` row so isolation-sensitive queries never need a join — the same pattern `memory_records` already uses.

### 2. Chunking is a pure, deterministic function

`chunking.ts#chunkDocument(content, maxChunkChars)` takes no dependencies and has no side effects: paragraphs (blank-line-separated blocks) are tagged with the nearest preceding Markdown heading as their `section`, then packed greedily up to `maxChunkChars` (default 1000, a character count — not a token count, consistent with `historyLimit`/`memoryLimit`'s existing count-based philosophy from ADR 0003). A paragraph longer than the limit is hard-split at character boundaries rather than left oversized, so no chunk ever violates the cap. Determinism matters for two reasons: identical content always embeds identically (no wasted API calls re-embedding unchanged text), and re-indexing is predictable — a developer can reason about what changed.

### 3. PDF is a real, registered format with a stub parser

Rather than omitting PDF entirely, `PdfDocumentParser` implements the same `DocumentParser` interface as `MarkdownDocumentParser`/`PlainTextDocumentParser` but throws `DocumentFormatNotImplementedError` when actually invoked. This means `pdf` is validated and recognized end-to-end (API request validation, the format enum in the database) without pulling in a PDF text-extraction dependency before one is needed — and when real PDF parsing is added later, it's a new file plus one registry entry, not a schema or API change. Importing a `pdf` document fails atomically: no `documents` row is left behind (verified in `documentService.test.ts`), so a rejected import never appears as a phantom entry in `listDocuments`.

### 4. Conversation retrieval renders memory and documentation as two sections, not one merged list

`ConversationService.sendMessage` now retrieves document chunks (via `DocumentService.search`, capped by a new `documentLimit`, default 5) in parallel with memory retrieval, and `contextAssembly.ts#buildSystemPrompt` renders them as two separately labeled sections ("Relevant memory for this workspace" / "Relevant documentation for this workspace") rather than interleaving both into one ranked list. Memory and document chunks carry different metadata (`scope` vs. `documentTitle`/`section`) and are produced by unrelated ranking calls — merging them would require inventing a cross-type relevance comparison this MVP has no basis for. Two clearly labeled sections is simpler and no less useful to the model.

### 5. `ConversationService`'s constructor became a dependencies object

Adding `documentService` and `documentLimit` would have been the third time a positional-argument change forced updating every call site's parameter order (after `intentEngine` in Phase 1.4). `ConversationServiceDependencies` replaces the positional constructor; every call site now names its fields, and adding a future dependency no longer risks a silent argument-order mistake.

### 6. Two unrelated bugs, fixed because they were found, not because they were in scope

While integration-testing document import against a workspace that doesn't exist, two real bugs surfaced:

- **Failure-logging could itself fail.** `documents.ts` and `memories.ts` both caught a create/import failure and logged it to `action_log` — but if the failure *was* "the workspace doesn't exist," that log write violated `action_log`'s own foreign key, turning a clean 404 into a confusing 500. Fixed by skipping the failure log specifically for `WorkspaceNotFoundError` (there's nothing valid to attribute it to) and, since `MemoryService.createMemory` had never validated workspace existence at all (unlike `DocumentService`/`ConversationService`), adding that check for consistency.
- **`npm test` silently under-ran.** Both `backend/package.json` and `ai-engine/package.json` had `"test": "tsx --test src/**/*.test.ts"` unquoted. `/bin/sh` on this system is `dash`, which doesn't support bash's `**` globstar — it collapses to one directory level, so `src/knowledge/parsers/registry.test.ts` (two levels deep) was silently never run by `npm test`, though it ran fine when the glob was passed to `tsx` directly and quoted. Fixed by quoting the pattern in both `package.json` scripts so tsx's own glob resolution (which handles `**` correctly regardless of shell) receives the literal string instead of a shell-expanded one.

## Consequences

- Retrieval now has two independent, symmetric services (`MemoryService`, `DocumentService`) with the same shape (workspace-scoped ranked search over an `EmbeddingProvider`-backed `vector` column) — a future third knowledge source could follow the same template.
- `import_document`/`reindex_document`/`delete_document` are registered at Tier 2 (`prepare`), matching `create_memory`'s classification: internal, reversible (a deleted document can be re-imported from its original source), no external effect.
- No PDF parsing dependency was added to the dependency tree this sprint — that decision is deferred to whenever a real PDF import is actually needed.
- The `npm test` fix means every future `*.test.ts` file, at any nesting depth, is guaranteed to run under `npm test` — a silent gap like this could otherwise persist indefinitely, since CI/local runs would report green without ever having exercised the missing file.
