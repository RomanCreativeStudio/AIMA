# backend

AIMA's API layer: authentication, workspace routing, the permission engine, the conversation pipeline, memory/retrieval, and the action log (docs/TECHNICAL_ARCHITECTURE.md §3, §4, §5, §6). This is the only component allowed to talk to the database, object storage, and `ai-engine/` — clients never call those directly.

## Structure

- **`src/config/`** — typed, validated environment configuration.
- **`src/db/`** — Postgres connection pool and the shared `Queryable` type (`Pool | Client`, so services work identically in production and inside a test transaction).
- **`src/types/`** — shared domain types (currently: workspace slugs).
- **`src/permissions/`** — the capability registry and `PermissionEngine` (docs/TECHNICAL_ARCHITECTURE.md §5).
- **`src/actionLog/`** — writes to the `action_log` table; the audit trail behind every logged action, gated or not.
- **`src/memory/`** — `MemoryService`: creates and ranks memory records (`docs/TECHNICAL_ARCHITECTURE.md` §4), embedding via `ai-engine`'s `EmbeddingProvider` abstraction. Enforces workspace isolation and memory-scope consistency.
- **`src/conversation/`** — `ConversationService`: the full conversation pipeline (User Input → Workspace Context → Memory Retrieval → Context Assembly → AI Provider → Response → Storage). `contextAssembly.ts` is a pure function building the system prompt; `errors.ts` defines `WorkspaceNotFoundError`/`ConversationNotFoundError` for clean 404 mapping at the route layer.
- **`src/routes/`** — HTTP endpoints. `health.ts` and `capabilities.ts` are foundation-stage; `ai.ts` is an explicitly-labeled smoke-test endpoint predating the real pipeline; `memories.ts` wires memory creation through the `PermissionEngine`/`ActionLogger` and exposes search + workspace-context retrieval; `conversations.ts` exposes conversation creation, history, and message sending (the real pipeline).
- **`src/testUtils/`** — shared test helpers (transaction-scoped test DB access, workspace/conversation seeding).
- **`src/app.ts`** — builds the Express app from injected dependencies (testable without a live database).
- **`src/index.ts`** — process entry point: loads config, wires dependencies, starts listening.

## What's intentionally not built yet

The following are deliberately out of scope until later sprints and are called out with `TODO`/doc-comments in the relevant files:

- Authentication and session management.
- Workspace CRUD and per-workspace permission tier overrides (`workspace_capability_settings`) — capability tiers currently resolve to their code-registered default only.
- Pending-approval creation/resolution for Tier 3 actions.
- Parsing an AI response into distinct, tiered action **intents** (e.g., "draft this email" as a Tier 2 artifact) — today a generated response is plain conversational text, logged once as a single Tier 1 `generate_ai_response` action. Structured intents land in the Integration Sprint alongside the first real external-action capability.
- Document/file ingestion into knowledge bases — today's memory records are created directly via the API, not extracted from uploaded files.
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
npm test
```

Tests connect to a real Postgres database (default `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`, override via `TEST_DATABASE_URL`) — see `docs/DEVELOPMENT_SETUP.md` §7.
