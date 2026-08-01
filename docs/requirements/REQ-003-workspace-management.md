# REQ 003: Workspace Management

**Document ID:** REQ-003
**Status:** Approved
**Priority:** High
**Category:** Functional

**Owner:** Product owner

## Purpose

Give AIMA structural separation between the distinct contexts it operates in (Personal, RCS, MFS, Development) so data, memory, and behavior never leak across them by accident.

## Description

Every workspace-scoped table carries a `workspace_id`, enforced at the schema and query level, not just filtered in application code (`ARCH-001` §6, "Workspace Architecture"). On top of that structural partitioning, each workspace carries its own configuration — `type`, `instructions`, `assistant_behavior`, `metadata` — implemented as the Workspace Configuration System (Phase 1.8), documented in `ARCH-001` §"Workspace Configuration System (Phase 1.8)" and decided in `ADR-0008`.

`slug` (`personal`/`rcs`/`mfs`/`development`) is the fixed identity established before this system existed and does not change; `type` is a separate, generic behavioral category that defaults from `slug` via `WORKSPACE_TYPE_BY_SLUG` when not explicitly set.

## Acceptance Criteria

1. A workspace can be created via `POST /api/workspaces` (`backend/src/routes/workspaces.ts`).
2. A workspace can be retrieved via `GET /api/workspaces/:workspaceId`.
3. A workspace can be updated (`type`, `instructions`, `assistantBehavior`, `metadata`) via `PATCH /api/workspaces/:workspaceId`.
4. All workspaces belonging to a user can be listed via `GET /api/users/:userId/workspaces`.
5. `slug` is fixed at creation and is not part of the update payload.
6. A `NULL` `type` in the database resolves to a slug-based default in application code (`personal`→`personal`, `rcs`→`business`, `mfs`→`creative`, `development`→`development`), so pre-existing rows keep working unchanged.
7. Every workspace-scoped table carries a `workspace_id`, and all queries issued by the API layer are scoped by the active workspace context — there is no code path that queries "all data" without an explicit, logged cross-workspace exception (`ARCH-001` §6).
8. Workspace create/read/update endpoints are deliberately ungated (no permission tier) — configuring one of the four fixed workspace kinds is an infrastructure/setup operation, not a conversational capability (`ARCH-001` §"Workspace Configuration System").

## Dependencies

`REQ-002` (User Management) — a workspace belongs to a user (`userId`).

## Related ADRs

`ADR-0008` — User Identity & Workspace Intelligence Layer.

## Related Architecture

`ARCH-001` §"Workspace Configuration System (Phase 1.8)", `ARCH-001` §6 "Workspace Architecture".

## Related Tests

`backend/src/workspaces/workspaceService.test.ts`.

## Related Implementation

`backend/src/workspaces/workspaceService.ts`, `backend/src/workspaces/types.ts`, `backend/src/workspaces/errors.ts`, `backend/src/routes/workspaces.ts`, `database/migrations/0008_user_profile_and_workspace_config.sql`.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial requirement, formalizing the existing Workspace Configuration System (Phase 1.8) implementation and the structural isolation model it sits on. |
