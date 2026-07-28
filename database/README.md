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
| `0008_user_profile_and_workspace_config.sql` | Adds `preferences`/`communication_style`/`default_workspace_id` to `users`; adds a `workspace_type` enum (`personal`/`business`/`creative`/`development`) plus `type` (nullable, falls back to a slug-based default in code), `instructions`, `assistant_behavior`, `metadata`, and `updated_at` to `workspaces` (docs/decisions/0008-user-identity-and-workspace-intelligence.md #1). |
| `0009_preferences.sql` | Adds a `preference_category` enum (`writing_style`/`response_preferences`/`workflow_preferences`/`project_rules`) and the `preferences` table — the Preference Memory Layer, structured settings kept separate from `memory_records` (docs/decisions/0008-user-identity-and-workspace-intelligence.md #3). |
| `0010_conversation_sequence.sql` | Adds a monotonic `sequence` column (and supporting index) to `conversations`, so the macOS app's conversation list (docs/decisions/0009-macos-experience-foundation.md) has a stable "most recently active first" ordering independent of `updated_at` collisions — the same fix as `0003_message_sequence.sql` and `0006_approval_lifecycle.sql`, now applied to a third table. |
| `0011_integrations.sql` | Adds an `integration_provider` enum (`gmail`/`github`/`calendar`) and `integration_status` enum (`disconnected`/`connected`/`error`), plus `workspace_integrations` (per-workspace connection status, unique on `(workspace_id, provider)`) and `integration_credentials` (1:1, encrypted `payload`/`iv`/`auth_tag`, `rotated_at`) — the External Integrations Foundation's storage layer (docs/decisions/0011-external-integrations-foundation.md). |
| `0012_workflows.sql` | Adds `github_issue` to `draft_type` (a new draft kind for "Create GitHub issue draft"), a `workflow_key` enum (the four built-in workflows), `workflow_run_status`/`workflow_step_status` enums, and `workflow_runs`/`workflow_step_runs` (execution state, with a monotonic `sequence` column on `workflow_runs` for stable history ordering) — the Workflow Orchestration Foundation's storage layer (docs/decisions/0012-workflow-orchestration-foundation.md). |
| `0013_action_log_sequence.sql` | Adds a monotonic `sequence` column (and supporting index) to `action_log`, so `ActionLogger.list` (Phase 2.5's "recent activity") has a stable newest-first order independent of `created_at` collisions — the same fix as `0003_message_sequence.sql`/`0006_approval_lifecycle.sql`/`0010_conversation_sequence.sql`/`0012_workflows.sql`, now applied to a fifth table. |

## Entities

| Table | Purpose |
|---|---|
| `users` | The AIMA account holder. Single-user in the MVP. Carries a `preferences` JSONB settings blob, `communication_style`, and `default_workspace_id` (Phase 1.8). Created/read by `backend/src/users/userService.ts`. |
| `workspaces` | One row per (`user`, workspace kind) — `personal`, `rcs`, `mfs`, `development` (docs/PRODUCT_BIBLE.md §1). The isolation boundary everything else hangs off of. Also carries `type` (a generic `personal`/`business`/`creative`/`development` category, independent of the fixed slug), `instructions`, `assistant_behavior`, and `metadata` (Phase 1.8). Created/read by `backend/src/workspaces/workspaceService.ts`. |
| `conversations` | A chat thread, scoped to one workspace. Ordered by the monotonic `sequence` column (not `updated_at` — see `0010_conversation_sequence.sql`), bumped via `touchConversation()` whenever a message is sent, so `listConversations` can return "most recently active first". Created/read by `backend/src/conversation/conversationService.ts`. |
| `messages` | Individual turns within a conversation, ordered by the monotonic `sequence` column (not `created_at` — see `0003_message_sequence.sql`). |
| `memory_records` | Durable memory, always workspace-scoped, classified by `scope` (`user`/`workspace`/`conversation`/`project`), with an `embedding` column and HNSW index for ranked retrieval (docs/TECHNICAL_ARCHITECTURE.md §4). `conversation` scope requires `conversation_id`; `project` scope requires `project_key`; both are enforced by a `CHECK` constraint, not just application code. |
| `tasks` | Task/project items, workspace-scoped: `title`, `description`, `status`, `priority` (`low`/`medium`/`high`, default `medium`), timestamps. Created/read by `backend/src/tasks/taskService.ts`. |
| `documents` | Ingested reference material (Markdown/plaintext/PDF), workspace-scoped, storing metadata (`title`, `format`, `source`, `tags`, `version`) and the canonical `raw_content` so re-indexing doesn't require re-supplying content. Created/read by `backend/src/knowledge/documentService.ts`. |
| `document_chunks` | Deterministically chunked, embedded pieces of a document (`docs/decisions/0005-knowledge-ingestion.md`), with a denormalized `workspace_id` and an HNSW index for ranked retrieval, mirroring `memory_records`. |
| `capabilities` | The permission-tier registry — mirrors `backend/src/permissions/registry.ts` (docs/TECHNICAL_ARCHITECTURE.md §5). |
| `workspace_capability_settings` | User-promoted per-workspace tier overrides. |
| `pending_approvals` | Tier 3 intents awaiting explicit user confirmation. Lifecycle `status` is `pending`/`approved`/`rejected`; a fourth state, `expired`, is derived from `expires_at` at read time and never stored (`0006_approval_lifecycle.sql`). Created/read by `backend/src/approval/approvalEngine.ts`. |
| `drafts` | Held content — `email`/`proposal`/`client_response`/`report` — a user reviews before anything is sent, workspace-scoped (`0007_drafts.sql`). Created/read by `backend/src/drafts/draftService.ts`. |
| `preferences` | Structured, categorized workspace settings (`writing_style`/`response_preferences`/`workflow_preferences`/`project_rules`) that shape assistant behavior, unique per (workspace, category, key) (`0009_preferences.sql`). Created/read by `backend/src/preferences/preferenceService.ts`. |
| `workspace_integrations` | One row per (`workspace`, provider) — `enabled`, `status`, `connected_at`, `last_validated_at` (`0011_integrations.sql`). Never a row exists without a connect attempt; a provider a workspace hasn't connected simply has no row (the service layer fills in a disconnected placeholder). Created/read by `backend/src/integrations/integrationService.ts`. |
| `integration_credentials` | The encrypted credential material for a connected integration — `encrypted_payload`/`iv`/`auth_tag` (AES-256-GCM, `backend/src/integrations/encryption.ts`), 1:1 with `workspace_integrations` via `integration_id`, deleted outright on disconnect. Never queried directly by a route — only `IntegrationService.getDecryptedCredentials` reads it. |
| `workflow_runs` | One row per started workflow execution — `workflow_key`, `status`, `current_step_index`, `input`/`result` (JSONB), ordered by a monotonic `sequence` column for stable "newest first" history (`0012_workflows.sql`). Created/read by `backend/src/workflows/workflowService.ts`. |
| `workflow_step_runs` | One row per step attempt within a `workflow_runs` row — `step_index`, `step_key`, `status`, a denormalized `capability_id` FK, and `pending_approval_id` (nullable, `ON DELETE SET NULL` — see `0012_workflows.sql`'s own comment on why not the default `RESTRICT`), plus the step's `output` once it runs. |
| `action_log` | Audit trail for every Tier 3/4 execution. Ordered by a monotonic `sequence` column (`0013_action_log_sequence.sql`) for `ActionLogger.list`'s stable newest-first "recent activity" feed (Phase 2.5). |

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
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0008_user_profile_and_workspace_config.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0009_preferences.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0010_conversation_sequence.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0011_integrations.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0012_workflows.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0013_action_log_sequence.sql
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
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0008_user_profile_and_workspace_config.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0009_preferences.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0010_conversation_sequence.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0011_integrations.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0012_workflows.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0013_action_log_sequence.sql
```

Tests default to `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`; override with the `TEST_DATABASE_URL` environment variable if your local setup differs. Each test either runs inside a transaction that's rolled back, or cleans up the rows it seeded — the test database is never reset automatically between runs. This matters for anything that syncs the capability registry into the `capabilities` table via a real (non-transactional) connection — those upserts persist permanently, so tests proving "this specific capability has no DB row" must use a one-off capability name rather than assuming the table is empty.

## Adding a migration

Add a new numbered file (`0005_<description>.sql`) — never edit a migration that has already been applied anywhere. Keep each migration additive and reversible where practical.
