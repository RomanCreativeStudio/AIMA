# ADR 0006: Assistant Core Orchestration Layer

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3 & §4, `backend/src/core/`, `backend/src/tasks/`, `backend/src/health/`

## Context

Phase 1.6 asked for "the central orchestration layer that connects AIMA capabilities" — receiving requests, determining workspace context, calling intent detection, retrieving memory and documents, building AI context, calling the AI provider, and returning a structured response. By this phase, `ConversationService.sendMessage` already did all of that inline. The central design question was whether to build a second, parallel orchestrator (risking duplication) or to extract and formalize what already existed.

## Decisions

### 1. Extract, don't duplicate: `ConversationService` keeps persistence, `AimaCoreService` owns orchestration

`ConversationService.sendMessage` was doing two genuinely different things in one method: (a) validating the conversation belongs to its workspace and persisting messages, and (b) gathering context, detecting intent, and calling the AI provider. Only (b) is "orchestration" in the sense Phase 1.6 asked for. The refactor pulled (b) out into `AimaCoreService.handleRequest`, which `ConversationService` now calls after loading history and before saving the assistant's reply. This means:

- No pipeline logic is duplicated — `AimaCoreService` is the only place "gather context → detect intent → build prompt → call AI provider" happens.
- `AimaCoreService` takes conversation history as a plain, already-loaded array rather than a `conversationId` — it has no idea `conversations`/`messages` tables exist. This is what makes it reusable: anything that can produce a workspace slug, a query, and a list of prior turns can get a workspace-aware AI response without persisting a conversation first.
- `ConversationService`'s dependency list actually got *shorter* as a result (it no longer holds `memoryService`, `documentService`, `aiProvider`, or `intentEngine` directly — only `aimaCoreService`, `permissionEngine`, `actionLogger`, `db`), which is the sign this was a real separation of concerns rather than just moving code around.

### 2. `ContextManager` takes pre-fetched history, not a `conversationId`

The Unified Context Manager (`gatherContext`) combines memory, documents, and history into one `UnifiedContext`. History loading/capping stays a `ConversationService` concern (it owns the `messages` table); `ContextManager` only applies `memoryLimit`/`documentLimit` to what it retrieves itself and passes history through unchanged. This keeps `ContextManager` testable with a plain in-memory array for history, no `conversations` table required.

### 3. Assistant Behavior Layer replaces a one-line description with real per-workspace instructions

`contextAssembly.ts` previously had a hardcoded `WORKSPACE_DESCRIPTIONS` map — one sentence per workspace. `AssistantProfile` (`backend/src/core/assistantProfiles.ts`) adds a `responseInstructions` field with actual behavioral guidance (e.g., RCS mode treats anything resembling client communication as needing approval before sending; MFS mode flags lore contradictions instead of silently overriding them). `contextAssembly.ts` moved from `conversation/` to `core/` alongside it, since it's now consumed by `AimaCoreService`, not `ConversationService` directly. Still a plain lookup (`getAssistantProfile`), not a class or DB-backed registry — promoting it to something user-editable is future work once a UI exists to edit it.

### 4. Task Foundation: minimal on purpose, reusing what already existed

The `tasks` table and the `create_task` capability (Tier 2/prepare) have existed since the Foundation Sprint and Phase 1.4 respectively — `create_task` was registered specifically because the `create_task` *intent* needed a capability to resolve a tier against, but nothing ever created a real task. `TaskService` finally gives it a caller: create/list/get/update/delete, workspace-isolated, mirroring `MemoryService`/`DocumentService`'s shape. Only creation is routed through the `PermissionEngine`/`ActionLogger`; update/delete are plain scoped writes. This is a deliberate scope cut for a phase explicitly asking for foundation, not a full feature — the task said "no advanced task UI," which this reads as "no advanced task *system*" either: assignment, subtasks, labels, and gated mutation-by-mutation logging are all left for whenever a real task-management feature is scoped.

### 5. System Health Layer checks configuration, not a live AI call

`HealthService.check()` verifies the database, `memory_records`, and `document_chunks` are queryable, and reports the AI provider's configured name. It does **not** issue a real completion request to verify the provider actually works — a `GET /health` endpoint might be polled every few seconds by monitoring, and a real API call on every poll would mean burning tokens/cost and adding latency purely to answer "is this backend healthy." Reporting configuration (which provider is selected) is a reasonable proxy for this MVP; a deeper liveness check is a tradeoff to revisit if the configured-but-broken-provider failure mode actually happens in practice.

## Consequences

- Every future capability that needs "ask AIMA something, workspace-aware" (not just chat) can depend on `AimaCoreService` directly instead of going through `ConversationService`'s persistence machinery.
- `contextAssembly.ts` and its tests moved from `backend/src/conversation/` to `backend/src/core/` — a pure rename/move plus a signature change (from raw `WorkspaceSlug` to `AssistantProfile`), not a behavior change; the rendered prompt text is identical except for now including `responseInstructions`.
- `create_task`'s capability registration from Phase 1.4 finally has a real, working caller — closing a gap that existed since that phase.
- `GET /health`'s response shape changed from `{ status, timestamp, database }` to `{ status, timestamp, checks: { database, aiProvider, memory, knowledge } }` — there are no clients depending on the old shape yet (no UI exists), so this is a clean break, not a breaking change in practice.
