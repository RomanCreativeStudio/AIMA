# database

Schema for AIMA's Postgres database. Migrations are plain, numbered SQL files applied in order — no ORM or migration framework yet, to keep the Foundation Sprint dependency-light (`docs/DEVELOPMENT_SETUP.md` §9, Rule 1). Revisit this choice if/when migration volume or team size justifies a tool like `node-pg-migrate` or Prisma Migrate.

## Requirements

- PostgreSQL 15+ (developed against 16).
- The [`pgvector`](https://github.com/pgvector/pgvector) extension available on the server (`CREATE EXTENSION vector;`). Managed providers such as Supabase ship this by default; for a self-managed local Postgres install the `postgresql-<version>-pgvector` package (or equivalent) first.

## Entities

| Table | Purpose |
|---|---|
| `users` | The AIMA account holder. Single-user in the MVP. |
| `workspaces` | One row per (`user`, workspace kind) — `personal`, `rcs`, `mfs`, `development` (docs/PRODUCT_BIBLE.md §1). The isolation boundary everything else hangs off of. |
| `conversations` | A chat thread, scoped to one workspace. |
| `messages` | Individual turns within a conversation. |
| `memory_records` | Durable long-term memory, workspace-scoped, with an embedding column for retrieval (docs/TECHNICAL_ARCHITECTURE.md §4). |
| `tasks` | Task/project items, workspace-scoped. |
| `capabilities` | The permission-tier registry — mirrors `backend/src/permissions/registry.ts` (docs/TECHNICAL_ARCHITECTURE.md §5). |
| `workspace_capability_settings` | User-promoted per-workspace tier overrides. |
| `pending_approvals` | Tier 3 intents awaiting explicit user confirmation. |
| `action_log` | Audit trail for every Tier 3/4 execution. |

## Running migrations locally

```bash
createdb aima_dev
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0001_init.sql
```

Point `backend/.env`'s `DATABASE_URL` at this database.

## Adding a migration

Add a new numbered file (`0002_<description>.sql`) — never edit a migration that has already been applied anywhere. Keep each migration additive and reversible where practical.
