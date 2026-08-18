# AIMA Authentication Foundation — Implementation Planning

**Document ID:** REQ-001-PLAN
**Document Name:** AIMA Authentication Foundation — Implementation Planning
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational planning artifact for `REQ-001`; subordinate to `CONST-001`, `HB-001`, `ARCH-001`
**Owner:** Lead Software Architect
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `REQ-001`, `ECIA-001`
**Dependents:** Future authentication implementation work (Phase 4)
**Review Frequency:** Whenever authentication implementation begins, or `ARCH-001`'s authentication design changes
**Last Updated:** 2026-08-01
**Related Documents:** [`REQ-001-authentication.md`](REQ-001-authentication.md), [`REQ-INDEX.md`](REQ-INDEX.md), [`RTM.md`](RTM.md), [`../governance/ECIA-001-authentication-foundation.md`](../governance/ECIA-001-authentication-foundation.md), [`../governance/RISK-001-unauthenticated-endpoints.md`](../governance/RISK-001-unauthenticated-endpoints.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md)

---

## Purpose

This is a planning artifact, not a requirement or a decision. It expands `REQ-001` (Authentication) with the deeper analysis needed before implementation work begins — current state, design recap, integration points, and failure modes — while committing to no specific auth provider, session library, or database schema. Where a decision isn't finalized, this document says so explicitly rather than picking an answer.

**No code was written to produce this document.** Every "current state" claim below was verified by reading the actual source referenced; every "planned" item is drawn from `ARCH-001`'s existing design or marked as an open question.

## Current Authentication State (Repository Audit)

- No authentication code exists anywhere in the repository. `backend/src/middleware/` contains only `requestLogger.ts` and `errorHandler.ts` — no auth check.
- `backend/src/app.ts`'s middleware stack is `helmet()` → `cors()` → `express.json()` → `requestLogger()`, then routers mounted directly — no authentication middleware sits in front of any router.
- `backend/src/oauth/` is entirely for **external-integration OAuth** (Gmail, GitHub, Calendar accounts the AI acts on behalf of) — not user login to AIMA itself. `OAuthService`, `githubOAuthProvider.ts`, `googleOAuthProvider.ts` have no relationship to authenticating an AIMA user.
- `UserProfile` (`backend/src/users/types.ts`) has no password, token, or credential field of any kind.
- Every route — `GET /workspaces/:workspaceId` included — resolves its resource purely from the URL parameter, with no check that the caller has any relationship to that resource (confirmed by reading `backend/src/routes/workspaces.ts`). This is the concrete, present-day gap `RISK-001` registers.

## `ARCH-001` Authentication Design (Recap)

`ARCH-001` already made this design decision; this section restates it, it does not change it:

- A **managed auth provider** (`ARCH-001` §8) rather than a self-built credential store — no specific provider is named or chosen.
- **Session-based auth**: short-lived access tokens plus refresh tokens (`ARCH-001` §"Authentication").
- **Per-device session tracking**, with a user-visible "signed in devices" list and one-tap revocation.
- **Rate-limited** authentication endpoints, to mitigate credential-stuffing/brute-force even in a single-user system.
- Framed explicitly as protecting **one account from unauthorized device/browser access**, not multi-tenant user management (`ARCH-001` §"Authentication": "authentication exists primarily to secure the account against unauthorized device/browser access, not to manage multiple tenants").

## Existing Backend Modules Relevant to Authentication

| Module | Relevance | Auth-relevant today? |
| --- | --- | --- |
| `backend/src/users/` | Owns `UserProfile`; the identity auth would ultimately attach to | No credential/session fields |
| `backend/src/workspaces/` | Owns workspace CRUD; every workspace-scoped request currently trusts the caller-supplied `workspaceId` | No ownership check |
| `backend/src/permissions/` | `PermissionEngine` resolves a capability's tier; operates purely on `actionType`, with no concept of "which user" | No identity input at all |
| `backend/src/middleware/` | Request logging and error handling only | No auth |
| `backend/src/oauth/` | External-integration credentials (Gmail/GitHub/Calendar), encrypted at rest | Unrelated to user login |
| `backend/src/config/` | `loadConfig()` would need new variables for a chosen provider (client ID/secret, JWKS URL, etc.) once one is picked | N/A yet |

## Security Boundaries

- **Account boundary** (planned, not built): distinguishes AIMA's owner from anyone else who reaches the API.
- **Workspace boundary** (built, `ARCH-001` §6): every workspace-scoped table carries `workspace_id`; queries are scoped by an "active workspace context." Today that context is *caller-supplied*, not *caller-authenticated* — the workspace boundary is real at the data layer but currently has no authenticated caller in front of it.
- **Capability/tier boundary** (built, `ARCH-001` §5): `PermissionEngine` gates *what* an action can do once it's decided to run; it says nothing about *who* is allowed to trigger it. Authentication and the Permission Engine are deliberately separate concerns in `ARCH-001` and should stay that way — auth answers "is this a legitimate caller," the Permission Engine answers "is this action allowed to happen automatically."

## Session Lifecycle (Planned)

Per `ARCH-001`, not yet implemented:

1. Login issues a short-lived access token and a longer-lived refresh token.
2. The access token authenticates subsequent requests; expiry forces a refresh.
3. Refresh exchanges the refresh token for a new access token, without re-entering credentials.
4. Each session is associated with a device/client, listed to the user, and individually revocable.
5. Revoking a device invalidates that session's refresh token; the corresponding access token stops being honored once it naturally expires (or immediately, if token introspection is used instead of local verification — an open question, see below).

**Open question, not decided:** whether access tokens are self-contained (JWT, verified locally, so a device revocation only takes effect once the JWT expires) or opaque (looked up against the provider on every request, so revocation is immediate but adds a network hop per request). This is a real trade-off the chosen managed provider's capabilities will constrain — not something this planning document should preempt.

## User Identity Flow (Planned)

Once built, a request would flow: **client → attaches access token → backend middleware validates it → resolves to a `UserProfile.id` → downstream route handlers use that resolved identity** (not a client-supplied one) to authorize workspace access. This changes today's flow only at the front: `backend/src/routes/workspaces.ts` and `backend/src/routes/users.ts` would gain an ownership check between "resolve caller identity" and "call the service," rather than trusting the URL parameter alone. No route handler logic is expected to change beyond adding that check — `UserService`/`WorkspaceService` themselves don't need to know auth exists.

## Permission Engine Integration

`PermissionEngine.evaluate(actionType)` (`backend/src/permissions/engine.ts`) takes no identity parameter today and shouldn't gain one just because auth exists — its job (resolving a capability's tier) is orthogonal to identity. What changes is *upstream*: today nothing stops an unauthenticated caller from reaching the code path that calls `PermissionEngine.evaluate` in the first place. Authentication closes that gap; it doesn't change the Permission Engine's own contract.

## Workspace Integration

Per `ARCH-001` §6, workspace-aware permission defaults are already anticipated ("the capability registry can carry different default tiers per workspace") but not implemented (`REQ-004` documents this gap directly). Authentication and that gap are independent: closing one doesn't require closing the other. What authentication *does* need from workspace integration is confirming a resolved identity actually owns the workspace it's requesting — a check that doesn't exist today (see Security Boundaries above).

## Failure Scenarios

| Scenario | Planned handling |
| --- | --- |
| No access token supplied | Reject with 401, no partial processing. |
| Expired access token | Reject with 401; client is expected to attempt a refresh. |
| Invalid/tampered access token | Reject with 401; treated identically to "no token" from the caller's perspective (no signal about *why* it failed, to avoid oracle-style probing). |
| Revoked device's token still presented | Reject once revocation has propagated (timing depends on the self-contained-vs-opaque token decision above). |
| Caller authenticated, but requests a workspace they don't own | Reject with 403/404 (open question: which, to avoid leaking existence of workspaces the caller can't see) — not silently served, which is today's actual behavior. |
| Auth provider outage | Existing sessions with a still-valid local access token continue to work if tokens are self-contained; new logins/refreshes fail. Exact behavior depends on the provider decision above. |
| Rate limit exceeded on an auth endpoint | Reject with 429, per `ARCH-001` §9's explicit rate-limiting requirement. |

## Requirements Expansion

The following elaborate `REQ-001`'s existing five acceptance criteria without changing their meaning — they are sub-criteria a real implementation would need to satisfy each of the five against, not new requirements:

- Criterion 1 (no anonymous/cross-workspace-default endpoints) requires **every** existing route file under `backend/src/routes/` to be re-audited, not just `users.ts`/`workspaces.ts` — the failure mode is "we authenticated some endpoints and missed one."
- Criterion 3 (short-lived access + refresh tokens) requires the specific expiry windows to be decided during implementation, not here — this document deliberately does not propose numbers.
- Criterion 4 (device-level revocation) requires deciding where device sessions are recorded (provider-native, or a local table AIMA owns) — see Database Impact Analysis below.
- Criterion 5 (rate limiting) requires deciding whether this is enforced by the managed provider, an API gateway, or in-process middleware — not decided here.

## API Requirement Placeholders

No API has been built or decided. The following are placeholders for what a real implementation is likely to need, based directly on the session lifecycle above — not a committed contract:

- `POST /api/auth/login` — Placeholder. Exact flow (redirect-based OAuth-style login vs. direct credential exchange) depends on the chosen provider.
- `POST /api/auth/refresh` — Placeholder.
- `POST /api/auth/logout` — Placeholder. Revokes the current session only.
- `GET /api/auth/devices` — Placeholder. Lists the caller's active sessions/devices.
- `DELETE /api/auth/devices/:deviceId` — Placeholder. Revokes a specific device's session.

## Database Impact Analysis

No schema change has been made or decided. Possibilities, not a decision:

- If the managed auth provider owns all session/device state itself (common for providers like the ones `ARCH-001` §8 names as examples), AIMA's own database may need **no new auth tables at all** — only a foreign-key-style reference from `users` to the provider's external user ID, if one doesn't already fit within the existing `users.id`.
- If AIMA needs to record device/session metadata locally (e.g. to render a "signed in devices" list without a provider API round-trip), a new table (tentatively `user_sessions` or similar — name not decided) would be needed, migrated the same way every other table has been (`database/migrations/00NN_*.sql`, following the existing numbering).
- No existing table (`users`, `workspaces`, `capabilities`, `pending_approvals`, etc.) is expected to need a new column for authentication itself — workspace/capability logic already assumes an authenticated caller exists, per Workspace Integration above; the caller's identity source doesn't need to change.

## Security Considerations

Restating `ARCH-001` §9 as it applies to implementation, not adding new commitments:

- TLS everywhere; auth tokens are never valid over plaintext HTTP.
- Provider credentials (client ID/secret, API keys) held server-side only, in the same managed-secrets convention `backend/src/config/env.ts` already uses for OAuth integration credentials — never shipped to a client.
- Rate limiting specifically on auth endpoints (login, refresh) — separate from any general API rate limiting, since credential-stuffing targets these endpoints specifically.
- No password (or equivalent secret) should ever be logged — `backend/src/logging/redact.ts`'s existing secret-redaction convention should cover any new auth-related log fields, extended if the field-name patterns it matches don't already catch them.

## Testing Strategy

Following the repository's existing conventions (confirmed by reading `backend/src/oauth/*.test.ts`, `backend/src/permissions/engine.test.ts`):

- No test may make a live call to the chosen auth provider — every provider integration in this repo (OAuth, embeddings, voice) uses an injectable `fetch` with a fake HTTP layer; auth should follow the same pattern.
- Unit tests for the auth middleware itself: valid token → resolved identity; missing/expired/invalid token → 401; each Failure Scenario above should map to a test case.
- **Regression tests are as important as new tests**: every existing route test (`users.test.ts`, `workspaces.test.ts`, and the rest) currently constructs requests with no auth context. Once auth middleware exists, these need a decision — either a test-only bypass/fixture identity (consistent with how `MockAPIClient`/mock providers are used elsewhere) or updating every test to attach a fixture token. This should be decided before implementation starts, not discovered mid-implementation.
- Workspace-ownership rejection (an authenticated caller requesting a workspace they don't own) needs an explicit isolation test, mirroring the existing cross-workspace isolation tests in `userService.test.ts`/`workspaceService.test.ts`.

## Migration Considerations

- This is presently a fully open, single-developer system with no existing users to migrate in the traditional sense — but it does have one real, actively-used identity (the developer's own seeded account) that must not be locked out mid-cutover.
- Rollout should not be a single flag flip that suddenly rejects all existing unauthenticated traffic — a coordinated cutover (documented separately, once a provider is chosen) is needed so local development and any deployed instance both get a working credential before enforcement turns on.
- New environment variables will be needed once a provider is chosen (client ID/secret, callback URLs, etc.), following the existing `loadConfig()` fail-fast pattern (`REQ-005`) rather than silently defaulting.
- No existing migration file needs to change; any new auth-related table is a new, additive migration, consistent with how every other feature in this repository has added tables.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial planning artifact for `REQ-001`, produced for EPIC-004 Sprint 4.2 (Authentication Foundation Planning). No code written; no provider or schema decided. |
