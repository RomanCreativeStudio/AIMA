# REQ 002: User Management

**Document ID:** REQ-002
**Status:** Approved
**Priority:** High
**Category:** Functional
**Owner:** Product owner

## Purpose

Give AIMA a durable identity for the person it assists — a profile the rest of the system (workspaces, preferences, conversation context) can attach to.

## Description

AIMA maintains a user profile — email, display name, an account-level preferences blob, a communication-style setting, and a default workspace — with read and update operations. This is implemented as the User Profile System (Phase 1.8), documented in `ARCH-001` §"User Profile System (Phase 1.8)" and decided in `ADR-0008`.

This is a single-user MVP: there is no signup flow. `createUser` exists for seeding a profile, not for public registration — consistent with `REQ-001` (Authentication), which is not yet implemented.

## Acceptance Criteria

1. A user profile can be retrieved by ID via `GET /api/users/:userId` (`backend/src/routes/users.ts`).
2. A user profile can be updated (`displayName`, `preferences`, `communicationStyle`, `defaultWorkspaceId`) via `PATCH /api/users/:userId` (`backend/src/routes/users.ts`).
3. Setting `defaultWorkspaceId` to a workspace that does not belong to the same user is rejected (`backend/src/users/userService.ts` throws `WorkspaceNotFoundError`) — the same cross-user isolation pattern used elsewhere in the system.
4. `preferences` here is a simple account-level settings blob (e.g. future UI/notification settings) — distinct from the structured, workspace-scoped Preference Memory Layer (`backend/src/preferences/`) that shapes AI behavior; the two must not be conflated.
5. No public signup/registration endpoint exists; user creation is for seeding only.

## Dependencies

`REQ-003` (Workspace Management) — a user's `defaultWorkspaceId` references a workspace. `REQ-001` (Authentication) is not a hard dependency of the data model itself, but public exposure of these endpoints without authentication is a known gap (see `REQ-001`).

## Related ADRs

`ADR-0008` — User Identity & Workspace Intelligence Layer.

## Related Architecture

`ARCH-001` §"User Profile System (Phase 1.8)".

## Related Tests

`backend/src/users/userService.test.ts`.

## Related Implementation

`backend/src/users/userService.ts`, `backend/src/users/types.ts`, `backend/src/users/errors.ts`, `backend/src/routes/users.ts`, `database/migrations/0008_user_profile_and_workspace_config.sql`.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial requirement, formalizing the existing User Profile System (Phase 1.8) implementation. |
