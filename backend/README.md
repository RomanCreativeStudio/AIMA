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
- **`src/intent/`** — `IntentEngine`: composes `ai-engine`'s `IntentClassifier` with the `PermissionEngine` to attach response metadata (intent, confidence, extracted parameters, an advisory `ApprovalRequirement`, suggested next action). Pure and database-free — never creates a pending approval or executes anything (docs/decisions/0004-intent-and-approval-engine.md). `intentCapabilityMap.ts` maps each of the 9 intents to the capability that would handle it (`null` for pure reads like `search_memory`/`search_documents`).
- **`src/approval/`** — `ApprovalEngine`: the DB-backed Tier 3 lifecycle (`evaluate`/`list`/`get`/`approve`/`reject`) over the `pending_approvals` table, with workspace isolation enforced the same way as `ConversationService`. Lifecycle states are `pending`/`approved`/`rejected`/`expired` — the last derived from `expires_at` at read time, never persisted (docs/decisions/0007-intent-and-approval-workflows.md).
- **`src/core/`** — the Assistant Core Orchestration Layer (Phase 1.6, docs/decisions/0006-assistant-core-orchestration.md). `aimaCoreService.ts` (`AimaCoreService`) is the coordinator: gather context, detect intent, resolve the intent's mapped capability and call `ApprovalEngine.evaluate` with its extracted parameters (Phase 1.7), load the workspace's own configuration via `WorkspaceService` and build the effective assistant profile (Phase 1.8), build the system prompt, call the AI provider, return a structured response — takes conversation history as a plain array, with no knowledge of `conversations`/`messages` tables. `contextManager.ts` (`ContextManager`) combines memory, document, (pass-through) history, and workspace preference context (Phase 1.8) with configurable `memoryLimit`/`documentLimit`. `assistantProfiles.ts` defines the static per-slug `AssistantProfile`s (Personal, Roman Creative Studio, Mythic Forge Studios, Development) plus `buildEffectiveProfile(workspace)`, which composes that static default with a workspace's own DB-backed `instructions`/`assistantBehavior` (Phase 1.8) — additive, never a replacement. `contextAssembly.ts` (moved here from `conversation/`) builds the system prompt from an `AssistantProfile` plus memory/document/preference context. `types.ts` defines `UnifiedContext`/`ContextLimits`.
- **`src/conversation/`** — `ConversationService`: owns conversation/message persistence and workspace isolation only. `sendMessage` validates the conversation, saves the user's message, loads history, delegates context-gathering/intent/approval/AI-calling to `AimaCoreService.handleRequest`, then saves the assistant's reply and logs the action (including the detected intent and real approval decision). Built from a `ConversationServiceDependencies` object (not positional arguments — see docs/decisions/0005-knowledge-ingestion.md #5 and 0006 #1). `errors.ts` defines `ConversationNotFoundError` for clean 404 mapping at the route layer.
- **`src/tasks/`** — `TaskService`: the Task Foundation (Phase 1.6, docs/decisions/0006-assistant-core-orchestration.md #4). Workspace-scoped create/list/get/update/delete over the `tasks` table, mirroring `MemoryService`/`DocumentService`'s shape. Only `createTask` is routed through the `PermissionEngine`/`ActionLogger` (reusing the `create_task` capability registered in Phase 1.4); update/delete are plain scoped writes — a deliberate scope cut for a foundation phase.
- **`src/drafts/`** — `DraftService`: the Action Preparation Layer (Phase 1.7, docs/decisions/0007-intent-and-approval-workflows.md #6). Workspace-scoped create/list/get/update/delete over the `drafts` table for held content — `email`/`proposal`/`client_response`/`report` — reviewed before anything is sent. Creation is gated per `type` by its own Tier 2 capability; never sends or executes anything.
- **`src/health/`** — `HealthService` (Phase 1.6): `check()` verifies the database, `memory_records`, and `document_chunks` are queryable, and reports the AI provider's configured name (not a live completion call — see docs/decisions/0006-assistant-core-orchestration.md #5).
- **`src/users/`** — `UserService`: the User Profile System (Phase 1.8, docs/decisions/0008-user-identity-and-workspace-intelligence.md). `getUser`/`updateProfile` over the `users` table's `displayName`/`preferences`/`communicationStyle`/`defaultWorkspaceId`; `createUser` exists for seeding only (no signup flow — single-user MVP).
- **`src/workspaces/`** — `WorkspaceService`: the Workspace Configuration System (Phase 1.8). The first application service to own the `workspaces` table (previously seeded only via raw SQL). `createWorkspace`/`getWorkspace`/`listWorkspaces`/`updateWorkspace` over `slug` (still the fixed identity), `type` (a generic category independent of `slug`, defaulting per `WORKSPACE_TYPE_BY_SLUG`), `instructions`, `assistantBehavior`, and `metadata`.
- **`src/preferences/`** — `PreferenceService`: the Preference Memory Layer (Phase 1.8). Structured, categorized (`writing_style`/`response_preferences`/`workflow_preferences`/`project_rules`) key-value settings, workspace-scoped, kept separate from `memory_records`. `setPreference` is an upsert on `(workspace, category, key)`.
- **`src/routes/`** — HTTP endpoints. `health.ts` reports the `HealthService` result; `capabilities.ts` is foundation-stage; `ai.ts` is an explicitly-labeled smoke-test endpoint predating the real pipeline; `memories.ts` wires memory creation through the `PermissionEngine`/`ActionLogger` and exposes search + workspace-context retrieval; `documents.ts` exposes the document lifecycle API; `tasks.ts` exposes the Task Foundation CRUD API; `drafts.ts` exposes the Action Preparation Layer CRUD API; `approvals.ts` exposes `list`/`get`/`approve`/`reject` over `pending_approvals` — deliberately no public "create" route (docs/decisions/0007-intent-and-approval-workflows.md #4); `users.ts`/`workspaces.ts`/`preferences.ts` expose the User Profile, Workspace Configuration, and Preference Memory Layer APIs (Phase 1.8); `conversations.ts` exposes conversation creation, history, and message sending (the real pipeline, now delegating to `AimaCoreService` including real approval creation).
- **`src/testUtils/`** — shared test helpers (transaction-scoped test DB access, workspace/conversation seeding, capability syncing).
- **`src/app.ts`** — builds the Express app from injected dependencies (testable without a live database).
- **`src/index.ts`** — process entry point: loads config, syncs capabilities to the DB, wires dependencies, starts listening.

## What's intentionally not built yet

The following are deliberately out of scope until later sprints and are called out with `TODO`/doc-comments in the relevant files:

- Authentication and session management.
- Per-workspace permission tier overrides (`workspace_capability_settings`) — capability tiers currently resolve to their code-registered default only, so `AimaCoreService`'s automatic approval creation (Phase 1.7) has no real Tier 3 capability to exercise yet under shipped defaults.
- A real external-action capability (e.g. actually sending an email) that consumes a `Draft` and requires approval — the Action Preparation Layer and Approval Engine are both ready for it, but nothing calls them together yet (Integration Sprint).
- Real PDF text extraction — `PdfDocumentParser` is a stub that fails clearly; the format is recognized end-to-end so a real implementation is a drop-in later.
- Token-level response streaming to the client — `POST .../messages` currently returns one JSON response once the full completion is ready.

## Running locally

See `docs/DEVELOPMENT_SETUP.md` §6. Quick reference:

```bash
cp .env.example .env   # then fill in DATABASE_URL, etc.
npm run dev             # from repo root: npm run dev --workspace=backend
```

`GET /health` reports database, AI provider, memory, and knowledge system status (`HealthService`).

## Testing

```bash
createdb aima_test
psql -d aima_test -f ../database/migrations/0001_init.sql
psql -d aima_test -f ../database/migrations/0002_memory_scopes.sql
psql -d aima_test -f ../database/migrations/0003_message_sequence.sql
psql -d aima_test -f ../database/migrations/0004_documents.sql
psql -d aima_test -f ../database/migrations/0005_task_priority.sql
psql -d aima_test -f ../database/migrations/0006_approval_lifecycle.sql
psql -d aima_test -f ../database/migrations/0007_drafts.sql
psql -d aima_test -f ../database/migrations/0008_user_profile_and_workspace_config.sql
psql -d aima_test -f ../database/migrations/0009_preferences.sql
npm test
```

Tests connect to a real Postgres database (default `postgresql://postgres:postgres@127.0.0.1:5432/aima_test`, override via `TEST_DATABASE_URL`) — see `docs/DEVELOPMENT_SETUP.md` §7. Tests exercising `ApprovalEngine` call `seedCapabilities()` (`src/testUtils/db.ts`) first, since it depends on the `capabilities` table being populated. Because this database is shared and never reset between runs, tests that need to prove "no capability row exists" register a one-off capability name in an in-memory-only registry rather than assuming the shared `capabilities` table is empty.

Note: `npm test` runs `tsx --test 'src/**/*.test.ts'` with the glob **quoted** — `/bin/sh` on Debian/Ubuntu is `dash`, which doesn't support bash's `**` recursive globstar, so an unquoted pattern silently misses test files more than one directory deep. Keep the quotes if you ever touch this script.
