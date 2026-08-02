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
| `0014_executions.sql` | Adds an `execution_status` enum (`pending`/`awaiting_approval`/`succeeded`/`failed`) and the `executions` table (request payload, response summary, error details, a nullable `pending_approval_id` FK, started/completed timestamps, and a monotonic `sequence` column from the start — the sixth table needing that fix, after `messages`/`pending_approvals`/`conversations`/`workflow_runs`/`action_log`) — the Action Execution Foundation's storage layer (docs/decisions/0014-action-execution-foundation.md). |
| `0015_oauth_token_expiry.sql` | Adds a non-secret `token_expires_at` column to `workspace_integrations` — the OAuth Framework's expiry-visibility layer (docs/decisions/0015-live-integration-providers.md): lets a client see when a connected integration's token expires without ever decrypting `integration_credentials`, which continues to hold the actual token material. |
| `0016_voice.sql` | Adds a `voice_session_status` enum (`active`/`ended`) and the `voice_sessions`/`voice_turns` tables — the Voice Assistant Foundation's storage layer (docs/decisions/0017-voice-assistant-foundation.md). A voice session optionally links to a `conversations` row (`ON DELETE SET NULL`, the same nullable-FK pattern `0012_workflows.sql` established); no audio bytes are ever persisted, only transcript/response text per turn. |
| `0017_memory_intelligence.sql` | Adds a `memory_type` enum (`short_term`/`long_term`) and extends `memory_records` with `importance_score`/`confidence_score` (`CHECK`-constrained to 0–1), `memory_type`, `last_accessed_at`, `expires_at`, and `archived_at` — the Advanced Memory System's scoring/lifecycle layer (docs/decisions/0019-advanced-memory-system.md), purely additive on top of `0002_memory_scopes.sql`'s existing scope model. Adds a partial index (`idx_memory_records_active`, `WHERE archived_at IS NULL`) so retrieval's "exclude archived" filter stays cheap. |
| `0019_embeddings.sql` | Adds `embedding_models` (one row per provider/model pair actually used) and `embeddings` (a generic embedding store for content types without their own embedding column — conversations, tasks, and forward-compatible `note`/`document` placeholders) plus an `embedding_source_type` enum — the Semantic Search & Context Retrieval layer (docs/decisions/0021-semantic-search-and-context-retrieval.md), deliberately separate from `memory_records.embedding`/`document_chunks.embedding`'s existing, well-tested paths. Includes an HNSW index (`idx_embeddings_vector`, cosine ops) mirroring `memory_records`/`document_chunks`. |
| `0020_auth_sessions.sql` | Adds the `auth_sessions` table — local session/device storage (`user_id` FK, `device_label`, unique `refresh_token_hash`, `created_at`/`last_seen_at`/`revoked_at`) per the Authentication Architecture (docs/decisions/0022-authentication-architecture.md, Decision 3): device/session state is owned by AIMA's own database, not the managed auth provider. Purely additive; rollback is `DROP TABLE IF EXISTS auth_sessions;`. |

## Entities

| Table | Purpose |
|---|---|
| `users` | The AIMA account holder. Single-user in the MVP. Carries a `preferences` JSONB settings blob, `communication_style`, and `default_workspace_id` (Phase 1.8). Created/read by `backend/src/users/userService.ts`. |
| `workspaces` | One row per (`user`, workspace kind) — `personal`, `rcs`, `mfs`, `development` (docs/PRODUCT_BIBLE.md §1). The isolation boundary everything else hangs off of. Also carries `type` (a generic `personal`/`business`/`creative`/`development` category, independent of the fixed slug), `instructions`, `assistant_behavior`, and `metadata` (Phase 1.8). Created/read by `backend/src/workspaces/workspaceService.ts`. |
| `conversations` | A chat thread, scoped to one workspace. Ordered by the monotonic `sequence` column (not `updated_at` — see `0010_conversation_sequence.sql`), bumped via `touchConversation()` whenever a message is sent, so `listConversations` can return "most recently active first". Created/read by `backend/src/conversation/conversationService.ts`. |
| `messages` | Individual turns within a conversation, ordered by the monotonic `sequence` column (not `created_at` — see `0003_message_sequence.sql`). |
| `memory_records` | Durable memory, always workspace-scoped, classified by `scope` (`user`/`workspace`/`conversation`/`project`), with an `embedding` column and HNSW index for ranked retrieval (docs/TECHNICAL_ARCHITECTURE.md §4). `conversation` scope requires `conversation_id`; `project` scope requires `project_key`; both are enforced by a `CHECK` constraint, not just application code. Also carries `importance_score`/`confidence_score`/`memory_type`/`last_accessed_at`/`expires_at`/`archived_at` (`0017_memory_intelligence.sql`) for scoring and lifecycle (archive/expire) beyond plain storage/retrieval. |
| `tasks` | Task/project items, workspace-scoped: `title`, `description`, `status`, `priority` (`low`/`medium`/`high`, default `medium`), timestamps. Created/read by `backend/src/tasks/taskService.ts`. |
| `documents` | Ingested reference material (Markdown/plaintext/PDF), workspace-scoped, storing metadata (`title`, `format`, `source`, `tags`, `version`) and the canonical `raw_content` so re-indexing doesn't require re-supplying content. Created/read by `backend/src/knowledge/documentService.ts`. |
| `document_chunks` | Deterministically chunked, embedded pieces of a document (`docs/decisions/0005-knowledge-ingestion.md`), with a denormalized `workspace_id` and an HNSW index for ranked retrieval, mirroring `memory_records`. |
| `capabilities` | The permission-tier registry — mirrors `backend/src/permissions/registry.ts` (docs/TECHNICAL_ARCHITECTURE.md §5). |
| `workspace_capability_settings` | User-promoted per-workspace tier overrides. |
| `pending_approvals` | Tier 3 intents awaiting explicit user confirmation. Lifecycle `status` is `pending`/`approved`/`rejected`; a fourth state, `expired`, is derived from `expires_at` at read time and never stored (`0006_approval_lifecycle.sql`). Created/read by `backend/src/approval/approvalEngine.ts`. |
| `drafts` | Held content — `email`/`proposal`/`client_response`/`report` — a user reviews before anything is sent, workspace-scoped (`0007_drafts.sql`). Created/read by `backend/src/drafts/draftService.ts`. |
| `preferences` | Structured, categorized workspace settings (`writing_style`/`response_preferences`/`workflow_preferences`/`project_rules`) that shape assistant behavior, unique per (workspace, category, key) (`0009_preferences.sql`). Created/read by `backend/src/preferences/preferenceService.ts`. |
| `workspace_integrations` | One row per (`workspace`, provider) — `enabled`, `status`, `connected_at`, `last_validated_at`, and (Phase 2.7) `token_expires_at` — a non-secret expiry timestamp for the client to display, kept separate from the encrypted token itself (`0011_integrations.sql`, `0015_oauth_token_expiry.sql`). Never a row exists without a connect attempt; a provider a workspace hasn't connected simply has no row (the service layer fills in a disconnected placeholder). Created/read by `backend/src/integrations/integrationService.ts`. |
| `integration_credentials` | The encrypted credential material for a connected integration — `encrypted_payload`/`iv`/`auth_tag` (AES-256-GCM, `backend/src/integrations/encryption.ts`), 1:1 with `workspace_integrations` via `integration_id`, deleted outright on disconnect. Never queried directly by a route — only `IntegrationService.getDecryptedCredentials` reads it. |
| `workflow_runs` | One row per started workflow execution — `workflow_key`, `status`, `current_step_index`, `input`/`result` (JSONB), ordered by a monotonic `sequence` column for stable "newest first" history (`0012_workflows.sql`). Created/read by `backend/src/workflows/workflowService.ts`. |
| `workflow_step_runs` | One row per step attempt within a `workflow_runs` row — `step_index`, `step_key`, `status`, a denormalized `capability_id` FK, and `pending_approval_id` (nullable, `ON DELETE SET NULL` — see `0012_workflows.sql`'s own comment on why not the default `RESTRICT`), plus the step's `output` once it runs. |
| `action_log` | Audit trail for every Tier 3/4 execution. Ordered by a monotonic `sequence` column (`0013_action_log_sequence.sql`) for `ActionLogger.list`'s stable newest-first "recent activity" feed (Phase 2.5). |
| `executions` | One row per requested external action — `provider`, `action_type`, `status`, `request_payload`/`response_summary` (JSONB), `error_details`, a nullable `pending_approval_id` FK, `started_at`/`completed_at`, ordered by a monotonic `sequence` column (`0014_executions.sql`). Created/read by `backend/src/execution/executionService.ts`. |
| `auth_sessions` | One row per issued session/device — `user_id` FK, `device_label`, a unique `refresh_token_hash` (never the raw token), `created_at`/`last_seen_at`/`revoked_at` (`0020_auth_sessions.sql`). The authoritative local record of "which devices are signed in" and "is this session still valid," independent of the auth provider's own state (docs/decisions/0022-authentication-architecture.md, Decision 3). Created/read by `backend/src/auth/sessionService.ts`. |
| `voice_sessions` | One row per voice interaction session — `workspace_id`, an optional `conversation_id` FK (`ON DELETE SET NULL`), `status` (`active`/`ended`), `started_at`/`ended_at`, ordered by a monotonic `sequence` column (`0016_voice.sql`). No audio bytes persisted by design. Created/read by `backend/src/voice/voiceService.ts`. |
| `voice_turns` | One row per turn within a `voice_sessions` row — `transcript_text`/`transcript_confidence`, `response_text`, ordered by a monotonic `sequence` column (`0016_voice.sql`). |
| `embedding_models` | One row per distinct (`provider_name`, `model_name`) pair actually used to produce a vector, so a stored embedding can record exactly which model produced it (`0019_embeddings.sql`). Created/read by `backend/src/embeddings/embeddingService.ts`. |
| `embeddings` | A generic embedding store for content types without their own dedicated embedding column (conversations, tasks; `note`/`document` reserved for future use) — `source_type`/`source_id` (not a FK; workspace isolation is still enforced directly via `workspace_id`), `content`/`content_hash` (skips re-embedding unchanged text), `embedding_model_id` FK, `embedding_version`, and the `embedding` vector itself, with an HNSW index (`0019_embeddings.sql`). Deliberately separate from `memory_records.embedding`/`document_chunks.embedding`. Created/read by `backend/src/embeddings/embeddingService.ts`, queried by `backend/src/embeddings/retrievalService.ts`. |

## Security boundary (RLS)

Row Level Security is deliberately **not** used on any table. The application backend (`backend/src/db/pool.ts`) is the sole database access path — a direct `pg` connection over `DATABASE_URL`, distinct from the Supabase `anon`/`authenticated` roles PostgREST serves requests as — and all authorization (`requireAuth`, `requireWorkspaceOwnership`/`requireUserOwnership`, `PermissionEngine`) happens in application code in front of every query, per `docs/TECHNICAL_ARCHITECTURE.md` §3 ("the API layer is the only component allowed to talk to the database"). On the live Supabase project, `anon`/`authenticated` PostgREST access to every `public` table is revoked (including `ALTER DEFAULT PRIVILEGES` so future tables stay closed automatically) rather than gated with row policies — see [`docs/decisions/0024-database-security-boundary.md`](../docs/decisions/0024-database-security-boundary.md) (`ADR-0024`) for the investigation and full reasoning. A Supabase security advisor scan will still report `rls_disabled_in_public` for every table; that finding is a known, accepted false positive for this architecture (ADR-0024's Trade-offs section explains why), not an unaddressed gap.

## Backup & restore

`database/backup.sh` / `database/restore.sh` (EPIC-005 Sprint 5.6), also wired up as `npm run db:backup` / `npm run db:restore`, wrap `pg_dump -Fc` / `pg_restore` — the standard Postgres logical backup/restore path, verified live this sprint against the real schema (schema, row counts, and a pgvector column's data all matched exactly after a round-trip, with `CREATE EXTENSION` for `pgcrypto`/`vector` recreated automatically by `pg_restore`, no manual extension setup needed on the target).

```bash
npm run db:backup -- postgresql://localhost:5432/aima_dev            # writes aima-backup-<timestamp>.dump
npm run db:restore -- postgresql://localhost:5432/aima_dev_restored aima-backup-20260101T000000Z.dump
```

Neither script is a scheduling or retention system — `backup.sh` takes one backup when run; deciding how often to run it, where to store the result, and how long to keep it is the operator's or hosting platform's job (a cron entry calling `backup.sh`, or — preferred once a production host is chosen — that platform's own managed Postgres automated-backup feature). No such schedule exists yet for this project; until one is configured, there is no standing backup of any real deployment's data. `restore.sh` is for a fresh/empty target database, the same posture as `apply-migrations.sh`: it doesn't merge into existing data, so it fails on the first colliding object if the target isn't empty.

## Running migrations locally

The fastest, least error-prone way to apply every migration to a fresh database is `database/apply-migrations.sh` (EPIC-005 Sprint 5.4), also wired up as `npm run db:migrate` from the repo root:

```bash
createdb aima_dev
npm run db:migrate -- postgresql://localhost:5432/aima_dev
# or: DATABASE_URL=postgresql://localhost:5432/aima_dev ./database/apply-migrations.sh
```

It globs `database/migrations/*.sql` and applies them in numeric order — since it reads the directory instead of a hardcoded list, it can never go stale the way the manual command sequence below once did (a real drift `database/README.md` shipped with for a while, caught in EPIC-005 Sprint 5.2). It is not a migration framework: it doesn't track which migrations a target database has already applied, so it's for a fresh database only — re-running it against an already-migrated one fails loudly on the first collision, by design, the same as running any of the commands below a second time would. All migrations run inside one `psql --single-transaction` (EPIC-005 Sprint 5.6): if any migration fails, every migration in the run rolls back together, so a fresh database left over from a failed run is still empty rather than half-migrated — fix the bad migration and re-run cleanly, no manual cleanup first. (The manual per-file commands below don't get this for free, since each is its own `psql` invocation/transaction.)

The equivalent manual commands, useful for applying one migration at a time or understanding exactly what the script does:

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
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0014_executions.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0015_oauth_token_expiry.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0016_voice.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0017_memory_intelligence.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0019_embeddings.sql
psql -d aima_dev -v ON_ERROR_STOP=1 -f database/migrations/0020_auth_sessions.sql
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
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0014_executions.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0015_oauth_token_expiry.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0016_voice.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0017_memory_intelligence.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0019_embeddings.sql
psql -d aima_test -v ON_ERROR_STOP=1 -f database/migrations/0020_auth_sessions.sql
```

Tests default to `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`; override with the `TEST_DATABASE_URL` environment variable if your local setup differs. Each test either runs inside a transaction that's rolled back, or cleans up the rows it seeded — the test database is never reset automatically between runs. This matters for anything that syncs the capability registry into the `capabilities` table via a real (non-transactional) connection — those upserts persist permanently, so tests proving "this specific capability has no DB row" must use a one-off capability name rather than assuming the table is empty.

## Adding a migration

Add a new numbered file (`0005_<description>.sql`) — never edit a migration that has already been applied anywhere. Keep each migration additive and reversible where practical.
