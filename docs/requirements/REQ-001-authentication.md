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

**Status as of EPIC-004 Sprint 4.6 (Authentication API Surface):**

1. **Met.** Every `/api` route except the OAuth provider callback and the new `POST /api/auth/login`/`POST /api/auth/refresh` pair (which cannot require a pre-existing token — see `backend/src/routes/auth.ts`) now sits behind `requireAuth`; every workspace-scoped route additionally sits behind `requireWorkspaceOwnership`, and every user-scoped route behind `requireUserOwnership` (`backend/src/app.ts`). Cross-user access and unknown-resource access both return the same 404, and unauthenticated requests return 401. `GET /health` remains intentionally public (infrastructure/monitoring convention, not an API business endpoint).
2. **Met** at the mechanism level — `AuthProvider` abstraction with a Supabase Auth implementation, selected via `AUTH_PROVIDER`. No self-built credential store exists or is planned.
3. **Met.** `POST /api/auth/login` and `POST /api/auth/refresh` now exist as real HTTP endpoints — a client can obtain and rotate a token pair through this API. Login authenticates through `AuthProvider.signInWithPassword` (the direct-credential-exchange flow `REQ-001-PLAN`'s API placeholders already named as an option, matching Supabase GoTrue's real password grant), then creates a local `auth_sessions` row before returning tokens.
4. **Met.** `GET /api/auth/sessions` (list the caller's own sessions) and `DELETE /api/auth/sessions/:sessionId` (revoke one, 404 if it belongs to someone else) are now real HTTP endpoints over `SessionService.listSessions`/`getSession`/`revokeSession`. `POST /api/auth/logout` revokes the current session (identified by the refresh token in the request body) by default, or every session for the caller when `allSessions: true` is explicitly sent. A dedicated "signed in devices" UI screen is still unbuilt (client-app work, out of this requirement's backend scope), but the API it would call now exists and is tested.
5. **Not met.** No rate limiting exists on any endpoint, auth or otherwise.

Status stays `Approved`, not `Implemented`: criterion 5 is not yet satisfied. This is a substantial, verified improvement over Sprint 4.5's state (where the enforcement mechanism was wired in but no client could obtain a token at all) — not the requirement's completion.

## Dependencies

None registered yet. `REQ-002` (User Management) and `REQ-003` (Workspace Management) will depend on this requirement once building real endpoint protection.

## Related ADRs

`ADR-0022` (Authentication Architecture) — decides the provider (Supabase Auth via an `AuthProvider` abstraction), token/session model (JWT access + rotating opaque refresh), device/session revocation, identity mapping, and workspace authorization enforcement.

## Related Architecture

`ARCH-001` §"Authentication" (Core Architecture Components), `ARCH-001` §9 "Security Considerations" → "Authentication".

## Related Tests

Foundation-layer unit/integration tests (EPIC-004 Sprint 4.4):

- `backend/src/auth/jwt.test.ts`, `backend/src/auth/mockAuthProvider.test.ts`, `backend/src/auth/supabaseAuthProvider.test.ts` — token verification/refresh/revocation, valid/invalid/expired tokens.
- `backend/src/auth/sessionService.test.ts` — session creation, refresh-token rotation, revocation (including reuse-of-a-revoked-token), per-user listing/isolation.
- `backend/src/middleware/auth.test.ts` — `requireAuth` over real HTTP: valid token, missing header, invalid token, expired token.
- `backend/src/middleware/workspaceOwnership.test.ts` — `requireWorkspaceOwnership` over real HTTP: owner allowed, cross-user access rejected (404), unknown workspace (404), unauthenticated (401), malformed workspace id (400).

Live-wiring tests, added against the real `app.ts` middleware stack (EPIC-004 Sprint 4.5) — every one of the 17 existing route-suite files under `backend/src/routes/*.test.ts` now attaches a real `Authorization` header via `backend/src/testUtils/auth.ts`'s `authHeader()`, and `backend/src/routes/workspaces.test.ts`, `tasks.test.ts`, `memories.test.ts`, and `users.test.ts` carry explicit new coverage for: authenticated success, missing token (401), invalid token (401), expired token (401), cross-user workspace/user access (404), and unknown workspace (404). Every existing positive-path test across all 17 files was adapted, not bypassed, to keep testing real request/response behavior end to end.

Authentication API surface tests (EPIC-004 Sprint 4.6):

- `backend/src/auth/mockAuthProvider.test.ts`, `backend/src/auth/supabaseAuthProvider.test.ts` — new `signInWithPassword` coverage: correct credentials issue a valid token pair, wrong password/rejected credentials throw `AuthLoginFailedError`.
- `backend/src/auth/sessionService.test.ts` — new `getSession`/`findByRefreshToken` coverage: found and not-found cases for both.
- `backend/src/routes/auth.test.ts` (new) — real HTTP coverage over `backend/src/app.ts`'s full middleware stack: successful login (creates a session, returns tokens), invalid email/wrong password/malformed email (401/400), refresh success and rotation, refresh reuse detection (401), logout (revokes the named session only, unless `allSessions: true`), session listing scoped to the caller, and unauthorized session access (deleting another user's session returns 404).

## Related Implementation

Foundation layer (EPIC-004 Sprint 4.4) plus live integration (EPIC-004 Sprint 4.5), implementing `ADR-0022` exactly:

- `database/migrations/0020_auth_sessions.sql` — local session/device storage.
- `backend/src/auth/types.ts`, `errors.ts`, `jwt.ts` — the `AuthProvider` abstraction and standards-based RS256/JWKS verification.
- `backend/src/auth/mockAuthProvider.ts`, `supabaseAuthProvider.ts`, `registry.ts` — the mock and Supabase Auth implementations, selected via `AUTH_PROVIDER`.
- `backend/src/auth/sessionService.ts` — local session lifecycle (create/refresh-with-rotation/revoke/list) over `auth_sessions`.
- `backend/src/middleware/auth.ts` — `requireAuth`, access-token validation and identity injection.
- `backend/src/middleware/workspaceOwnership.ts` — `requireWorkspaceOwnership`, uniform 404 for both "workspace doesn't exist" and "belongs to another user"; now also rejects a malformed workspace id with 400 before it ever reaches a database query.
- `backend/src/middleware/userOwnership.ts` — `requireUserOwnership` (new, Sprint 4.5), the parallel check `REQ-001-PLAN`'s "User Identity Flow" section anticipated for `/users/:userId`-shaped routes; a pure parameter comparison against `req.identity`, no database lookup needed, since `users.id` **is** the subject id (ADR-0022 Decision 4).
- `backend/src/app.ts` (Sprint 4.5) — wires `requireAuth` in front of every `/api` route except the OAuth callback, and `requireWorkspaceOwnership`/`requireUserOwnership` in front of `/api/workspaces/:workspaceId/*` and `/api/users/:userId/*` respectively, via path-scoped middleware so no individual route file needs to know auth exists.
- `backend/src/routes/oauth.ts` (Sprint 4.5) — split into `oauthRouter` (the workspace-scoped `start` route, now protected like any other workspace resource) and `oauthCallbackRouter` (the provider-driven `callback` route, which must stay public since it carries no AIMA `Authorization` header).
- `backend/src/routes/workspaces.ts` (Sprint 4.5) — `POST /workspaces` now derives the owning `userId` from the authenticated caller's resolved identity (`req.identity`), never from a client-supplied request body field, per `REQ-001-PLAN`'s "User Identity Flow."
- `backend/src/index.ts` (Sprint 4.5) — constructs the real `AuthProvider` via `createAuthProviderFromEnv()` for the composition root.

Authentication API surface (EPIC-004 Sprint 4.6), resolving `REQ-001-PLAN`'s remaining API placeholders:

- `backend/src/auth/types.ts` — added `signInWithPassword(email, password)` to the `AuthProvider` interface: the direct-credential-exchange login flow `REQ-001-PLAN` already named as an option, matching Supabase GoTrue's real password grant. Not a new provider and not an invented OAuth flow — `ADR-0022`'s already-chosen provider supports this mechanism natively.
- `backend/src/auth/mockAuthProvider.ts` — implements `signInWithPassword` plus two deterministic helpers, `mockSubjectIdFor`/`mockPasswordFor`, standing in for a real credential store so tests can exercise genuine right/wrong-password paths without a database.
- `backend/src/auth/supabaseAuthProvider.ts` — implements `signInWithPassword` against Supabase's `POST /auth/v1/token?grant_type=password`, mirroring `refreshSession`'s existing structure.
- `backend/src/auth/errors.ts` — added `AuthLoginFailedError`, with a deliberately generic message so the login endpoint can't be used to enumerate registered emails.
- `backend/src/auth/sessionService.ts` — added `getSession(sessionId)` and `findByRefreshToken(refreshToken)`, read-only lookups the new session-management and logout routes need (distinct from `refresh()`, which also rotates).
- `backend/src/routes/auth.ts` (new) — the client-accessible HTTP surface: `POST /api/auth/login`, `POST /api/auth/refresh` (`authPublicRouter`, mounted ahead of the `requireAuth` gate — the same public/protected split Sprint 4.5 established for the OAuth callback), and `POST /api/auth/logout`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:sessionId` (`authRouter`, mounted behind the gate). Login resolves the FK target (`auth_sessions.user_id` → `users.id`) via `UserService.getUser` before creating a session, translating an unknown user to the same generic 401 as a wrong password.
- `backend/src/app.ts` — added `sessionService` as an optional `AppDependencies` field (mirrors the `proactiveIntelligenceService`/`retrievalService` precedent, not the required `authProvider` one, since the new routes are purely additive); mounts `authPublicRouter`/`authRouter` only when it's supplied.
- `backend/src/index.ts` — constructs a real `SessionService` from the pool and the already-constructed `authProvider`, and passes it into `createApp`.

Still not built: rate limiting on auth endpoints (acceptance criterion 5) — see [`REQ-001-implementation-plan.md`](REQ-001-implementation-plan.md) (`REQ-001-PLAN`).

## Related Governance Records

[`ECIA-001`](../governance/ECIA-001-authentication-foundation.md) (Authentication Foundation — Implementation Planning). [`RISK-001`](../governance/RISK-001-unauthenticated-endpoints.md) (Every Backend Endpoint Is Reachable Without Authentication), registered as a direct consequence of this requirement not yet being implemented.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.5 | 2026-08-01 | EPIC-004 Sprint 4.6 (Authentication API Surface): built the client-accessible HTTP layer — `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:sessionId`. Extended `AuthProvider` with `signInWithPassword` (both `MockAuthProvider` and `SupabaseAuthProvider`), extended `SessionService` with `getSession`/`findByRefreshToken`, added `AuthLoginFailedError`. Wired `sessionService` into `app.ts` (optional dependency, mirroring the `proactiveIntelligenceService` pattern) and `index.ts`. Acceptance criteria 1–4 are now met; criterion 5 (rate limiting) remains unmet. Status stays `Approved`, not `Implemented`. No `ADR-0022` change, no new provider, no invented OAuth flow — this sprint implements login mechanics the already-decided provider (Supabase Auth) natively supports. |
| 1.4 | 2026-08-01 | EPIC-004 Sprint 4.5 (Authentication Integration): wired `requireAuth`/`requireWorkspaceOwnership` into every `/api` route in `backend/src/app.ts` (except the public OAuth callback), added `requireUserOwnership` for `/users/:userId`-shaped routes, fixed a malformed-workspace-id 500 the wiring would otherwise have introduced, and changed `POST /workspaces` to derive the owner from the authenticated caller instead of a client-supplied body field. Adapted all 17 existing route test suites to attach real tokens; added explicit new coverage for missing/invalid/expired tokens and cross-user access. Acceptance criterion 1 is now met; criteria 3–4 are partially met (mechanism wired, no login/refresh/devices HTTP endpoints yet); criterion 5 remains unmet. Status stays `Approved`, not `Implemented`. No `ADR-0022` change — this sprint implements the already-decided design, it does not revise it. |
| 1.3 | 2026-08-01 | EPIC-004 Sprint 4.4 (Authentication Implementation Foundation): built the `AuthProvider` abstraction (mock + Supabase), JWT/JWKS verification, session lifecycle (`SessionService`, `auth_sessions` migration), and `requireAuth`/`requireWorkspaceOwnership` middleware — all implementing `ADR-0022` exactly. Updated Related Tests/Related Implementation with real paths. Status stays `Approved`, not `Implemented`: nothing is yet wired into `app.ts` or an existing route, so no acceptance criterion is met in production terms yet. |
| 1.2 | 2026-08-01 | Added `ADR-0022` (Authentication Architecture) reference following EPIC-004 Sprint 4.3. No change to Status, Acceptance Criteria, or scope — the ADR decides *how* this requirement will be implemented, not whether it's required. |
| 1.1 | 2026-08-01 | Added planning cross-references (`REQ-001-PLAN`, `ECIA-001`, `RISK-001`) following EPIC-004 Sprint 4.2 (Authentication Foundation Planning). No change to Status, Acceptance Criteria, or scope — planning only, no code written. |
| 1.0 | 2026-08-01 | Initial requirement, formalizing `ARCH-001`'s existing, not-yet-built authentication design. |
