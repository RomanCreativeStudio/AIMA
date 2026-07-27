# backend

AIMA's API layer: authentication, workspace routing, the permission engine, business logic, memory/retrieval, and the action log (docs/TECHNICAL_ARCHITECTURE.md §3, §5, §6). This is the only component allowed to talk to the database, object storage, and `ai-engine/` — clients never call those directly.

## Structure

- **`src/config/`** — typed, validated environment configuration.
- **`src/db/`** — Postgres connection pool.
- **`src/types/`** — shared domain types (currently: workspace slugs).
- **`src/permissions/`** — the capability registry and `PermissionEngine` (docs/TECHNICAL_ARCHITECTURE.md §5).
- **`src/actionLog/`** — writes to the `action_log` table; the audit trail behind every Tier 3/4 action.
- **`src/memory/`** — `MemoryService`: creates and ranks memory records (`docs/TECHNICAL_ARCHITECTURE.md` §4), embedding via `ai-engine`'s `EmbeddingProvider` abstraction. Enforces workspace isolation and memory-scope consistency.
- **`src/routes/`** — HTTP endpoints. `health.ts` and `capabilities.ts` are foundation-stage; `ai.ts` is an explicitly-labeled smoke-test endpoint, not the final chat pipeline; `memories.ts` wires memory creation through the `PermissionEngine`/`ActionLogger` and exposes search + workspace-context retrieval.
- **`src/testUtils/`** — shared test helpers (transaction-scoped test DB access, workspace/conversation seeding).
- **`src/app.ts`** — builds the Express app from injected dependencies (testable without a live database).
- **`src/index.ts`** — process entry point: loads config, wires dependencies, starts listening.

## What's intentionally not built yet

The following are deliberately out of scope until later sprints and are called out with `TODO`/doc-comments in the relevant files:

- Authentication and session management.
- Workspace CRUD and per-workspace permission tier overrides (`workspace_capability_settings`) — capability tiers currently resolve to their code-registered default only.
- Pending-approval creation/resolution for Tier 3 actions.
- Context assembly into an actual AI chat request (memory retrieval exists as a building block — `MemoryService.getWorkspaceContext` — but nothing yet injects it into a system prompt; there is no chat pipeline to assemble into until the Integration Sprint).
- Document/file ingestion into knowledge bases — today's memory records are created directly via the API, not extracted from uploaded files.

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
npm test
```

Tests connect to a real Postgres database (default `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`, override via `TEST_DATABASE_URL`) — see `docs/DEVELOPMENT_SETUP.md` §7.
