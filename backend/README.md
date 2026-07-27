# backend

AIMA's API layer: authentication, workspace routing, the permission engine, business logic, and the action log (docs/TECHNICAL_ARCHITECTURE.md §3, §5, §6). This is the only component allowed to talk to the database, object storage, and `ai-engine/` — clients never call those directly.

## Structure

- **`src/config/`** — typed, validated environment configuration.
- **`src/db/`** — Postgres connection pool.
- **`src/types/`** — shared domain types (currently: workspace slugs).
- **`src/permissions/`** — the capability registry and `PermissionEngine` (docs/TECHNICAL_ARCHITECTURE.md §5).
- **`src/actionLog/`** — writes to the `action_log` table; the audit trail behind every Tier 3/4 action.
- **`src/routes/`** — HTTP endpoints. `health.ts` and `capabilities.ts` are foundation-stage; `ai.ts` is an explicitly-labeled smoke-test endpoint, not the final chat pipeline.
- **`src/app.ts`** — builds the Express app from injected dependencies (testable without a live database).
- **`src/index.ts`** — process entry point: loads config, wires dependencies, starts listening.

## What's intentionally not built yet

This is Foundation Sprint scope (docs/TECHNICAL_ARCHITECTURE.md §10). The following are deliberately out of scope until later sprints and are called out with `TODO`/doc-comments in the relevant files:

- Authentication and session management.
- Workspace CRUD and per-workspace permission tier overrides (`workspace_capability_settings`).
- Pending-approval creation/resolution for Tier 3 actions.
- Context assembly, long-term memory, and knowledge retrieval (owned by `ai-engine/`, Intelligence Sprint).

## Running locally

See `docs/DEVELOPMENT_SETUP.md` §6. Quick reference:

```bash
cp .env.example .env   # then fill in DATABASE_URL, etc.
npm run dev             # from repo root: npm run dev --workspace=backend
```

`GET /health` reports process and database connectivity status.
