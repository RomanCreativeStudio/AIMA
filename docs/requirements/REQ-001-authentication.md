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

None registered yet — no ADR has decided the specific managed auth provider or session library.

## Related Architecture

`ARCH-001` §"Authentication" (Core Architecture Components), `ARCH-001` §9 "Security Considerations" → "Authentication".

## Related Tests

Not yet implemented.

## Related Implementation

Not yet implemented.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial requirement, formalizing `ARCH-001`'s existing, not-yet-built authentication design. |
