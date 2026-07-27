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
| `0003_message_sequence.sql` | Adds a monotonic `sequence` column (and supporting index) to `messages`, so conversation history has a stable ordering independent of `created_at` collisions. See `docs/decisions/0003-conversation-pipeline.md`. |
| `0004_documents.sql` | Adds `documents` and `document_chunks` for ingested reference material — separate from `memory_records` (docs/decisions/0005-knowledge-ingestion.md). Includes a `document_format` enum and an HNSW index on `document_chunks.embedding`. |
| `0005_task_priority.sql` | Adds a `task_priority` enum (`low`/`medium`/`high`) and a `priority` column (default `medium`) to `tasks`, completing the Task Foundation model (docs/decisions/0006-assistant-core-orchestration.md #4). |
| `0006_approval_lifecycle.sql` | Renames `pending_approvals.status`'s `declined` value to `rejected`, adds an `expires_at` column (default 24 hours from creation), and adds a `sequence` column for stable newest-first ordering. `expired` is a derived state, never written to `status` (docs/decisions/0007-intent-and-approval-workflows.md #2). |
| `0007_drafts.sql` | Adds a `draft_type` enum (`email`/`proposal`/`client_response`/`report`) and the `drafts` table — the Action Preparation Layer's foundation for held content reviewed before anything is sent (docs/decisions/0007-intent-and-approval-workflows.md #6). |

## Entities

| Table | Purpose |
|---|---|
| `users` | The AIMA account holder. Single-user in the MVP. |
| `workspaces` | One row per (`user`, workspace kind) — `personal`, `rcs`, `mfs`, `development` (docs/PRODUCT_BIBLE.md §1). The isolation boundary everything else hangs off of. |
| `conversations` | A chat thread, scoped to one workspace. Created/read by `backend/src/conversation/conversationService.ts`. |
| `messages` | Individual turns within a conversation, ordered by the monotonic `sequence` column (not `created_at` — see `0003_message_sequence.sql`). |
| `memory_records` | Durable memory, always workspace-scoped, classified by `scope` (`user`/`workspace`/`conversation`/`project`), with an `embedding` column and HNSW index for ranked retrieval (docs/TECHNICAL_ARCHITECTURE.md §4). `conversation` scope requires `conversation_id`; `project` scope requires `project_key`; both are enforced by a `CHECK` constraint, not just application code. |
| `tasks` | Task/project items, workspace-scoped: `title`, `description`, `status`, `priority` (`low`/`medium`/`high`, default `medium`), timestamps. Created/read by `backend/src/tasks/taskService.ts`. |
| `documents` | Ingested reference material (Markdown/plaintext/PDF), workspace-scoped, storing metadata (`title`, `format`, `source`, `tags`, `version`) and the canonical `raw_content` so re-indexing doesn't require re-supplying content. Created/read by `backend/src/knowledge/documentService.ts`. |
| `document_chunks` | Deterministically chunked, embedded pieces of a document (`docs/decisions/0005-knowledge-ingestion.md`), with a denormalized `workspace_id` and an HNSW index for ranked retrieval, mirroring `memory_records`. |
| `capabilities` | The permission-tier registry — mirrors `backend/src/permissions/registry.ts` (docs/TECHNICAL_ARCHITECTURE.md §5). |
| `workspace_capability_settings` | User-promoted per-workspace tier overrides. |
| `pending_approvals` | Tier 3 intents awaiting explicit user confirmation. Lifecycle `status` is `pending`/`approved`/`rejected`; a fourth state, `expired`, is derived from `expires_at` at read time and never stored (`0006_approval_lifecycle.sql`). Created/read by `backend/src/approval/approvalEngine.ts`. |
| `drafts` | Held content — `email`/`proposal`/`client_response`/`report` — a user reviews before anything is sent, workspace-scoped (`0007_drafts.sql`). Created/read by `backend/src/drafts/draftService.ts`. |
| `action_log` | Audit trail for every Tier 3/4 execution. |

## Running migrations locally

```bash
createdb aima_dev
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0001_init.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0002_memory_scopes.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0003_message_sequence.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0004_documents.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0005_task_priority.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0006_approval_lifecycle.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0007_drafts.sql
```

Point `backend/.env`'s `DATABASE_URL` at this database.

### Test database

`backend/`'s integration tests (`docs/DEVELOPMENT_SETUP.md` §7) run against a real Postgres database, not a mock. Create and migrate a separate database for it:

```bash
createdb aima_test
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0001_init.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0002_memory_scopes.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0003_message_sequence.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0004_documents.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0005_task_priority.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0006_approval_lifecycle.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0007_drafts.sql
```

Tests default to `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`; override with the `TEST_DATABASE_URL` environment variable if your local setup differs. Each test either runs inside a transaction that's rolled back, or cleans up the rows it seeded — the test database is never reset automatically between runs. This matters for anything that syncs the capability registry into the `capabilities` table via a real (non-transactional) connection — those upserts persist permanently, so tests proving "this specific capability has no DB row" must use a one-off capability name rather than assuming the table is empty.

## Adding a migration

Add a new numbered file (`0005_<description>.sql`) — never edit a migration that has already been applied anywhere. Keep each migration additive and reversible where practical.
