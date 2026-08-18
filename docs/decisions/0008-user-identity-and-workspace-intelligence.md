# ADR 0008: User Identity & Workspace Intelligence Layer

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3, §4, §6, `backend/src/users/`, `backend/src/workspaces/`, `backend/src/preferences/`, `backend/src/core/`

## Context

Since the Foundation Sprint, `users` and `workspaces` existed only as schema — every test and the (nonexistent) onboarding flow inserted rows directly via SQL. `workspaces.slug` was, and remains, the fixed identity from docs/PRODUCT_BIBLE.md §1 (`personal`/`rcs`/`mfs`/`development`); nothing let a workspace carry its own configuration beyond `name`. Phase 1.8 asked for a real user profile, a workspace configuration system with a generic `type` taxonomy (Personal/Business/Creative/Development), a structured preference layer distinct from memory, and for the response pipeline to actually use all of it. The central design question was how to introduce dynamic, per-workspace configuration without disturbing the fixed-slug model every other phase has built on.

## Decisions

### 1. `type` is independent of `slug`, and nullable at the database level

`slug` stays exactly what it was: the fixed identity, still validated against `WORKSPACE_SLUGS` everywhere. `type` (`personal`/`business`/`creative`/`development`) is a new, separate column — a generic behavioral category a workspace belongs to, decoupled from its specific identity so a future non-fixed workspace could share a type's default behavior without needing its own dedicated slug. Today's four slugs map to types 1:1 (`WORKSPACE_TYPE_BY_SLUG`: personal→personal, rcs→business, mfs→creative, development→development).

The column itself is nullable. `WorkspaceService.createWorkspace` always resolves and stores an explicit value (the caller's choice, or the slug-based default), but every row inserted before this migration — and every existing test helper (`seedWorkspace()`, and six route test files' inline seed functions) that does a bare `INSERT INTO workspaces (user_id, slug, name)` — leaves `type` NULL. `WorkspaceService`'s row-mapper resolves that NULL to the same slug-based default at read time (`row.type ?? WORKSPACE_TYPE_BY_SLUG[row.slug]`), so the `Workspace` interface's `type` field is always a real value to every caller, while zero pre-existing INSERT statements needed to change. The same reasoning applied to `instructions` (nullable), `assistant_behavior`/`metadata` (JSONB, default `{}`), and `updated_at` (default `now()`) — every new column is either nullable or has a safe default, so this migration required no backfill and no test-helper changes beyond the `type` fallback.

### 2. Workspace configuration composes with the static profile, never replaces it

`backend/src/core/assistantProfiles.ts`'s static `ASSISTANT_PROFILES` (one per slug, Phase 1.6) stays exactly as it was — `getAssistantProfile(workspaceSlug)` is unchanged and still works anywhere only a slug is available. A new `buildEffectiveProfile(workspace)` takes the full DB-backed `Workspace` row and *appends* its `instructions` (free text) and a rendered `assistantBehavior` (JSONB) to the static base's `responseInstructions`, rather than overriding it. This means a workspace with no configuration behaves identically to before this phase, and workspace-specific instructions are additive, auditable text a developer can read directly off the static default plus the override — not a second, parallel prompt-construction path. `AimaCoreService.handleRequest` now calls `WorkspaceService.getWorkspace` every turn (in the same `Promise.all` as context gathering and intent detection) and passes the result to `buildEffectiveProfile`.

### 3. The Preference Memory Layer is a new table, not a `workspaces.preferences` JSONB blob

The task description's item 2 ("workspaces should support ... preferences") and item 3 ("create structured preferences separate from general memories") describe the same capability at two levels of detail, not two different ones — so there is no `workspaces.preferences` column. Instead, `preferences` is its own table: `(workspace_id, category, key, value)` with a unique constraint on `(workspace_id, category, key)`, four categories (`writing_style`/`response_preferences`/`workflow_preferences`/`project_rules`), and `setPreference` implemented as an upsert rather than an append-only create, since preferences are keyed settings ("writing_style.tone = formal"), not a list of independent items a user creates one at a time like tasks or drafts. `users.preferences` is a *separate*, deliberately simple JSONB blob for account-level settings (e.g. a future UI theme) — it is never surfaced to the AI prompt; only the structured `preferences` table is retrieved by `ContextManager` and rendered into the system prompt.

### 4. `ContextManager` finally gathers "workspace information," completing its Phase 1.6 brief

Phase 1.6 originally asked the Unified Context Manager to combine "conversation history, memory context, document context, and workspace information," but the fourth piece only ever amounted to tagging `UnifiedContext.workspaceSlug` for display. `ContextManager` now takes a `PreferenceService` dependency and fetches all of a workspace's preferences (uncapped — small and curated by design, unlike memory/documents which need `memoryLimit`/`documentLimit`) in the same `Promise.all` as memory and document retrieval. `contextAssembly.ts#buildSystemPrompt` renders them as a new, clearly labeled section between the workspace/profile line and the memory section.

### 5. No public "create arbitrary preference/workspace" ambiguity, but no auth gate either

`WorkspaceService.createWorkspace` and the `POST /api/workspaces` route are intentionally ungated (no `PermissionEngine`/`ActionLogger`) — configuring one of the four fixed workspace kinds is an infrastructure/setup operation a user (or, later, an onboarding flow) performs once, not a conversational capability an AI-detected intent would trigger, so it doesn't belong in the capability registry any more than `GET /health` does. `PreferenceService.setPreference`, by contrast, *is* gated behind a new `set_preference` capability (Tier 2/prepare) and logged — setting a preference is exactly the kind of low-risk, repeatable, internally-effecting action the existing capability model already covers (mirroring `create_memory`). `UserService`'s profile update route is likewise ungated, following the same reasoning Task/Draft update/delete used in Phases 1.6–1.7: a foundation-scope decision, not an oversight.

## Consequences

- `AimaCoreService`'s constructor grew a `WorkspaceService` dependency; `ContextManager`'s grew a `PreferenceService` dependency. Every call site that constructs either (six route test files, `conversationService.test.ts`, `index.ts`) needed the same mechanical update already seen in Phases 1.6 and 1.7.
- `AimaResponse`/`UnifiedContext` are unchanged in shape at the top level (`preferences` was added to `UnifiedContext`, not a new top-level field) — the system prompt is richer, but the response schema clients already parse doesn't need new handling to keep working.
- Every future conversational capability that wants "does this workspace have an opinion on X" can read it from `preferences` without inventing a new mechanism; every future workspace-specific customization needed before a UI exists can be set directly via `PATCH /api/workspaces/:id`.
- `workspaces.type` being nullable-with-fallback is a deliberate asymmetry from `instructions`/`assistant_behavior`/`metadata` (which all default to an empty/absent value with no special-casing) — it exists solely to avoid a backfill migration and to keep every earlier phase's test helpers untouched; a future migration could backfill and tighten it to `NOT NULL` once there's a reason to (e.g. a query that needs to filter by type at the SQL level).
