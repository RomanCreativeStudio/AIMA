# REQ 001: Authentication

**Document ID:** REQ-001
**Status:** Approved
**Priority:** High
**Category:** Security
**Owner:** Product owner

## Purpose

Protect the AIMA account and API from unauthorized access. Authentication is the foundation every workspace-scoped, permission-gated endpoint (REQ-003, REQ-004) ultimately depends on — without it, "workspace isolation" and "permission tiers" are enforced against an unauthenticated caller.

## Description

The backend must authenticate every request before it reaches a workspace-scoped resource. `docs/TECHNICAL_ARCHITECTURE.md` (`ARCH-001`) already specifies this design in its "Authentication" section (Core Architecture Components) and again under §9 Security Considerations: a managed auth provider, session-based access tokens with refresh tokens, per-device revocation, and rate-limited auth endpoints. This requirement formalizes that existing architectural decision as a trackable requirement; it does not change it.

**Repository audit finding:** as of this requirement's authoring date, no authentication implementation exists. There is no `backend/src/auth/` module, no login/session/JWT/password field anywhere on `UserProfile` (`backend/src/users/types.ts`), and no authentication middleware in `backend/src/middleware/`. Every backend endpoint today is reachable without credentials. This requirement documents the target state, not the current state.

## Acceptance Criteria

1. Every backend endpoint requires an authenticated request; there are no anonymous or cross-workspace-by-default endpoints (`ARCH-001` §9, "API Security").
2. Authentication is provided by a managed auth provider (`ARCH-001` §8, "Technology Recommendations") rather than a self-built credential store.
3. Sessions use short-lived access tokens plus refresh tokens (`ARCH-001` §"Authentication").
4. Per-device session tracking is supported, with a user-visible "signed in devices" list and one-tap revocation (`ARCH-001` §"Authentication", §9).
5. All authentication endpoints are rate-limited to mitigate credential-stuffing/brute-force attempts (`ARCH-001` §9).

None of the above is met today (see repository audit finding above); each is a target condition for this requirement to be considered implemented.

## Dependencies

None registered yet. `REQ-002` (User Management) and `REQ-003` (Workspace Management) will depend on this requirement once building real endpoint protection.

## Related ADRs

`ADR-0022` (Authentication Architecture) — decides the provider (Supabase Auth via an `AuthProvider` abstraction), token/session model (JWT access + rotating opaque refresh), device/session revocation, identity mapping, and workspace authorization enforcement.

## Related Architecture

`ARCH-001` §"Authentication" (Core Architecture Components), `ARCH-001` §9 "Security Considerations" → "Authentication".

## Related Tests

Not yet implemented. A testing strategy (no live provider calls, regression risk for existing unauthenticated route tests, workspace-ownership rejection tests) is documented in [`REQ-001-implementation-plan.md`](REQ-001-implementation-plan.md).

## Related Implementation

Not yet implemented. Implementation planning (current-state audit, session lifecycle, identity flow, API/database placeholders) is documented in [`REQ-001-implementation-plan.md`](REQ-001-implementation-plan.md) (`REQ-001-PLAN`).

## Related Governance Records

[`ECIA-001`](../governance/ECIA-001-authentication-foundation.md) (Authentication Foundation — Implementation Planning). [`RISK-001`](../governance/RISK-001-unauthenticated-endpoints.md) (Every Backend Endpoint Is Reachable Without Authentication), registered as a direct consequence of this requirement not yet being implemented.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.2 | 2026-08-01 | Added `ADR-0022` (Authentication Architecture) reference following EPIC-004 Sprint 4.3. No change to Status, Acceptance Criteria, or scope — the ADR decides *how* this requirement will be implemented, not whether it's required. |
| 1.1 | 2026-08-01 | Added planning cross-references (`REQ-001-PLAN`, `ECIA-001`, `RISK-001`) following EPIC-004 Sprint 4.2 (Authentication Foundation Planning). No change to Status, Acceptance Criteria, or scope — planning only, no code written. |
| 1.0 | 2026-08-01 | Initial requirement, formalizing `ARCH-001`'s existing, not-yet-built authentication design. |
