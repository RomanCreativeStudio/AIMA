# backend

AIMA's API layer: authentication, workspace routing, the permission engine, intent detection, the approval lifecycle, the conversation pipeline, memory/document retrieval, and the action log (docs/TECHNICAL_ARCHITECTURE.md §3, §4, §5, §6). This is the only component allowed to talk to the database, object storage, and `ai-engine/` — clients never call those directly.

## Structure

- **`src/config/`** — typed, validated environment configuration.
- **`src/db/`** — Postgres connection pool, the shared `Queryable` type (`Pool | Client`, so services work identically in production and inside a test transaction), and `vector.ts` (`toVectorLiteral`, shared by `MemoryService` and `DocumentService`).
- **`src/types/`** — shared domain types (workspace slugs) and `errors.ts` (`WorkspaceNotFoundError`, shared by every workspace-scoped service).
- **`src/permissions/`** — the capability registry and `PermissionEngine` (docs/TECHNICAL_ARCHITECTURE.md §5), plus `syncCapabilities.ts`, which upserts the registry into the `capabilities` table at startup (required for `pending_approvals`' foreign key).
- **`src/actionLog/`** — writes to the `action_log` table; the audit trail behind every logged action, gated or not.
- **`src/memory/`** — `MemoryService`: creates and ranks memory records (`docs/TECHNICAL_ARCHITECTURE.md` §4), embedding via `ai-engine`'s `EmbeddingProvider` abstraction. Enforces workspace isolation and memory-scope consistency.
- **`src/knowledge/`** — `DocumentService`: the document ingestion lifecycle (import, re-index, delete, list, get, ranked search) over `documents`/`document_chunks` (docs/decisions/0005-knowledge-ingestion.md). `chunking.ts` is a pure, deterministic chunker; `parsers/` holds the `DocumentParser` abstraction (Markdown and plaintext real, PDF a stub that fails clearly).
- **`src/intent/`** — `IntentEngine`: composes `ai-engine`'s `IntentClassifier` with the `PermissionEngine` to attach response metadata (intent, confidence, approval requirement, suggested next action). Pure and database-free — never creates a pending approval or executes anything (docs/decisions/0004-intent-and-approval-engine.md). `intentCapabilityMap.ts` maps each intent to the capability that would handle it.
- **`src/approval/`** — `ApprovalEngine`: the DB-backed Tier 3 lifecycle (`evaluate`/`approve`/`deny`/`getStatus`) over the `pending_approvals` table, with workspace isolation enforced the same way as `ConversationService`.
- **`src/conversation/`** — `ConversationService`: the full conversation pipeline (User Input → Workspace Context → Memory + Document Retrieval → Context Assembly → AI Provider → Response → Storage), attaching both retrieved memory/documentation and `IntentEngine` output to every response. Built from a `ConversationServiceDependencies` object (not positional arguments — see docs/decisions/0005-knowledge-ingestion.md #5). `contextAssembly.ts` is a pure function building the system prompt (two labeled sections: memory, then documentation); `errors.ts` defines `ConversationNotFoundError` for clean 404 mapping at the route layer.
- **`src/routes/`** — HTTP endpoints. `health.ts` and `capabilities.ts` are foundation-stage; `ai.ts` is an explicitly-labeled smoke-test endpoint predating the real pipeline; `memories.ts` wires memory creation through the `PermissionEngine`/`ActionLogger` and exposes search + workspace-context retrieval; `documents.ts` exposes the document lifecycle API; `conversations.ts` exposes conversation creation, history, and message sending (the real pipeline, now including intent metadata and document retrieval). `ApprovalEngine` has no route yet — see `docs/decisions/0004-intent-and-approval-engine.md` for why.
- **`src/testUtils/`** — shared test helpers (transaction-scoped test DB access, workspace/conversation seeding, capability syncing).
- **`src/app.ts`** — builds the Express app from injected dependencies (testable without a live database).
- **`src/index.ts`** — process entry point: loads config, syncs capabilities to the DB, wires dependencies, starts listening.

## What's intentionally not built yet

The following are deliberately out of scope until later sprints and are called out with `TODO`/doc-comments in the relevant files:

- Authentication and session management.
- Workspace CRUD and per-workspace permission tier overrides (`workspace_capability_settings`) — capability tiers currently resolve to their code-registered default only.
- HTTP routes for `ApprovalEngine` (approve/deny by id) — deferred until a real Tier 3 capability exists for conversation traffic to actually trigger (Integration Sprint); today it's exercised directly in tests.
- Routing a conversation-detected Tier 3 intent through `ApprovalEngine` automatically — `IntentEngine` currently only *reports* the approval state a capability would need, it doesn't create the pending approval itself.
- Real PDF text extraction — `PdfDocumentParser` is a stub that fails clearly; the format is recognized end-to-end so a real implementation is a drop-in later.
- Token-level response streaming to the client — `POST .../messages` currently returns one JSON response once the full completion is ready.

## Running locally

See `docs/DEVELOPMENT_SETUP.md` §6. Quick reference:

```bash
cp .env.example .env   # then fill in DATABASE_URL, etc.
npm run dev             # from repo root: npm run dev --workspace=backend
```

`GET /health` reports process and database connectivity status.

## Testing

```bash
createdb aima_test
psql -d aima_test -f ../database/migrations/0001_init.sql
psql -d aima_test -f ../database/migrations/0002_memory_scopes.sql
psql -d aima_test -f ../database/migrations/0003_message_sequence.sql
psql -d aima_test -f ../database/migrations/0004_documents.sql
npm test
```

Tests connect to a real Postgres database (default `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`, override via `TEST_DATABASE_URL`) — see `docs/DEVELOPMENT_SETUP.md` §7. Tests exercising `ApprovalEngine` call `seedCapabilities()` (`src/testUtils/db.ts`) first, since it depends on the `capabilities` table being populated.

Note: `npm test` runs `tsx --test 'src/**/*.test.ts'` with the glob **quoted** — `/bin/sh` on Debian/Ubuntu is `dash`, which doesn't support bash's `**` recursive globstar, so an unquoted pattern silently misses test files more than one directory deep. Keep the quotes if you ever touch this script.
