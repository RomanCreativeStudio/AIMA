# database

Schema for AIMA's Postgres database. Migrations are plain, numbered SQL files applied in order — no ORM or migration framework yet, to keep the Foundation Sprint dependency-light (`docs/DEVELOPMENT_SETUP.md` §9, Rule 1). Revisit this choice if/when migration volume or team size justifies a tool like `node-pg-migrate` or Prisma Migrate.

## Requirements

- PostgreSQL 15+ (developed against 16).
- The [`pgvector`](https://github.com/pgvector/pgvector) extension available on the server (`CREATE EXTENSION vector;`), including HNSW index support (pgvector 0.5.0+; developed against 0.6.0). Managed providers such as Supabase ship this by default; for a self-managed local Postgres install the `postgresql-<version>-pgvector` package (or equivalent) first.

## Migrations

| File | Adds |
|---|---|
| `0001_init.sql` | `users`, `workspaces`, `conversations`, `messages`, `memory_records` (base columns), `tasks`, `capabilities`, `workspace_capability_settings`, `pending_approvals`, `action_log`. |
| `0002_memory_scopes.sql` | Extends `memory_records` with the four-way memory scope model (`scope`, `conversation_id`, `project_key`, `metadata`) and adds the HNSW vector index for retrieval. See `docs/decisions/0002-memory-and-embeddings.md`. |

## Entities

| Table | Purpose |
|---|---|
| `users` | The AIMA account holder. Single-user in the MVP. |
| `workspaces` | One row per (`user`, workspace kind) — `personal`, `rcs`, `mfs`, `development` (docs/PRODUCT_BIBLE.md §1). The isolation boundary everything else hangs off of. |
| `conversations` | A chat thread, scoped to one workspace. |
| `messages` | Individual turns within a conversation. |
| `memory_records` | Durable memory, always workspace-scoped, classified by `scope` (`user`/`workspace`/`conversation`/`project`), with an `embedding` column and HNSW index for ranked retrieval (docs/TECHNICAL_ARCHITECTURE.md §4). `conversation` scope requires `conversation_id`; `project` scope requires `project_key`; both are enforced by a `CHECK` constraint, not just application code. |
| `tasks` | Task/project items, workspace-scoped. |
| `capabilities` | The permission-tier registry — mirrors `backend/src/permissions/registry.ts` (docs/TECHNICAL_ARCHITECTURE.md §5). |
| `workspace_capability_settings` | User-promoted per-workspace tier overrides. |
| `pending_approvals` | Tier 3 intents awaiting explicit user confirmation. |
| `action_log` | Audit trail for every Tier 3/4 execution. |

## Running migrations locally

```bash
createdb aima_dev
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0001_init.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0002_memory_scopes.sql
```

Point `backend/.env`'s `DATABASE_URL` at this database.

### Test database

`backend/`'s integration tests (`docs/DEVELOPMENT_SETUP.md` §7) run against a real Postgres database, not a mock. Create and migrate a separate database for it:

```bash
createdb aima_test
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0001_init.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0002_memory_scopes.sql
```

Tests default to `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`; override with the `TEST_DATABASE_URL` environment variable if your local setup differs. Each test either runs inside a transaction that's rolled back, or cleans up the rows it seeded — the test database is never reset automatically between runs.

## Adding a migration

Add a new numbered file (`0003_<description>.sql`) — never edit a migration that has already been applied anywhere. Keep each migration additive and reversible where practical.
