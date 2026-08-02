# REQ 001: Authentication

**Document ID:** REQ-001
**Status:** Implemented
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

**Status as of EPIC-004 Sprint 4.7 (Authentication Rate Limiting):**

1. **Met.** Every `/api` route except the OAuth provider callback and the `POST /api/auth/login`/`POST /api/auth/refresh` pair (which cannot require a pre-existing token — see `backend/src/routes/auth.ts`) now sits behind `requireAuth`; every workspace-scoped route additionally sits behind `requireWorkspaceOwnership`, and every user-scoped route behind `requireUserOwnership` (`backend/src/app.ts`). Cross-user access and unknown-resource access both return the same 404, and unauthenticated requests return 401. `GET /health` remains intentionally public (infrastructure/monitoring convention, not an API business endpoint).
2. **Met** at the mechanism level — `AuthProvider` abstraction with a Supabase Auth implementation, selected via `AUTH_PROVIDER`. No self-built credential store exists or is planned.
3. **Met.** `POST /api/auth/login` and `POST /api/auth/refresh` exist as real HTTP endpoints — a client can obtain and rotate a token pair through this API. Login authenticates through `AuthProvider.signInWithPassword` (the direct-credential-exchange flow `REQ-001-PLAN`'s API placeholders already named as an option, matching Supabase GoTrue's real password grant), then creates a local `auth_sessions` row before returning tokens.
4. **Met.** `GET /api/auth/sessions` (list the caller's own sessions) and `DELETE /api/auth/sessions/:sessionId` (revoke one, 404 if it belongs to someone else) are real HTTP endpoints over `SessionService.listSessions`/`getSession`/`revokeSession`. `POST /api/auth/logout` revokes the current session (identified by the refresh token in the request body) by default, or every session for the caller when `allSessions: true` is explicitly sent. A dedicated "signed in devices" UI screen is still unbuilt (client-app work, out of this requirement's backend scope), but the API it would call now exists and is tested.
5. **Met.** `POST /api/auth/login` and `POST /api/auth/refresh` are rate-limited (`backend/src/middleware/rateLimit.ts`, `ADR-0023`): login is limited both by normalized email (5/15min, the primary credential-stuffing defense) and by source IP (20/15min, a backstop), refresh by source IP (20/15min). Over-limit requests receive `429` with a `Retry-After` header; a successful login/refresh resets that request's counters. `POST /api/auth/logout`/`GET /api/auth/sessions`/`DELETE /api/auth/sessions/:sessionId` are intentionally not rate-limited — all three already sit behind `requireAuth`, so brute-forcing them isn't the same threat as login/refresh.

All five acceptance criteria are now met. Status moves to `Implemented`.

**Status as of EPIC-004 Sprint 4.9 (Live Verification):** all five criteria above were verified against a real, active Supabase project (`cjdkijgwvirbbdkbtgjy`), not just the mock-fixture test suite — the gap `RISK-001`'s Sprint 4.5 entry explicitly left open. A local backend instance (local Postgres for `DATABASE_URL`, `AUTH_PROVIDER=supabase` pointed at the live project's Auth service, migrations `0001`–`0020` applied to both) exercised the real HTTP surface end to end: `POST /api/auth/login` against a seeded live Supabase Auth user, `GET /api/users/:userId` with the issued access token (200; 401 with no token), `GET /api/auth/sessions`, `POST /api/auth/refresh` (rotation, and 401 on reuse of the now-rotated token), rate limiting (6th attempt within the email window returned `429`), and `POST /api/auth/logout` (204, session `revoked_at` set, subsequent refresh 401). This surfaced one real bug: `verifyJwtRs256` (`backend/src/auth/jwt.ts`) only accepted RS256-signed tokens, but this live project's JWKS publishes an EC/P-256 key and its issued access tokens are ES256-signed (Supabase Auth's current default for projects using its "JWT Signing Keys" feature) — every one of that project's real tokens verified as `null`, a gap never exercised before this sprint because no earlier sprint had a live project to test against. Fixed by generalizing the function to `verifyJwtSignature`, which supports both RS256 (RSA) and ES256 (EC P-256, using `dsaEncoding: 'ieee-p1363'` for the raw-format JWS signature Node's default DER encoding doesn't expect) via the JWK's `kty`. This closes `RISK-001`'s one remaining open condition.

**Status as of EPIC-006 Sprint 6.4 (Automatic User Provisioning):** production live-usage after Sprint 6.1's deployment surfaced a real gap this requirement's acceptance criteria didn't cover: a Supabase Auth user who authenticates successfully but has no matching `public.users` row (identity mapping, `ADR-0022` Decision 4) was rejected by `POST /api/auth/login` with the same generic 401 as invalid credentials, because `UserService.getUser` threw `UserNotFoundError` and the route translated that to the same response as a wrong password (deliberately, to avoid enumeration — but with no other signal, this made a real infrastructure gap indistinguishable from a typo). Root cause: `ADR-0022` v1.0 left the `users.id`/provider-subject-ID reconciliation as a manual, implementation-time step (flagged as a risk, never mitigated); it was never carried out against the live production project. Fixed by extending `VerifiedAccessToken` (`backend/src/auth/types.ts`) with `email` (both `SupabaseAuthProvider` and `MockAuthProvider` now return it from the verified token's own claims — no second lookup) and adding `UserService.getOrProvisionFromAuth(id, email)` (`backend/src/users/userService.ts`): on a cache miss it inserts `id = ` the verified subject, `email = ` the verified email, `display_name = NULL`, via `INSERT ... ON CONFLICT (id) DO NOTHING`, then reads back the row either way — idempotent and safe under concurrent first logins for the same brand-new subject. `POST /api/auth/login` now calls this instead of `getUser` directly; an existing profile is read and used exactly as before, unchanged. See `ADR-0022` v1.1 for the full identity-mapping decision update. No new migration, no schema change, no new acceptance criterion — this closes an operational gap in how criteria 1–3's already-decided identity mapping actually gets established, not a change to what the criteria require.

## Dependencies

None registered yet. `REQ-002` (User Management) and `REQ-003` (Workspace Management) will depend on this requirement once building real endpoint protection.

## Related ADRs

`ADR-0022` (Authentication Architecture) — decides the provider (Supabase Auth via an `AuthProvider` abstraction), token/session model (JWT access + rotating opaque refresh), device/session revocation, identity mapping, and workspace authorization enforcement. `ADR-0023` (Authentication Rate Limiting) — decides the rate-limiting mechanism (in-process, in-memory, no distributed store) for acceptance criterion 5.

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

Authentication rate limiting tests (EPIC-004 Sprint 4.7):

- `backend/src/middleware/rateLimit.test.ts` (new) — `RateLimiter` unit coverage (attempts under/over max, per-key isolation, window reset via an injectable clock, `reset()` clearing a bucket) and `rateLimitMiddleware` HTTP coverage (allows under the limit, `429` + `Retry-After` once exceeded).
- `backend/src/routes/auth.test.ts` — new coverage using small test-local limiter configs: login/refresh succeed under their limits, `429` once exceeded (including that an over-limit request blocks even a correct password/valid refresh), different accounts' login buckets are isolated from each other, and a successful login/refresh resets that request's counters. Every pre-existing test in this file (Sprint 4.6's) continues to run against `defaultAuthRateLimiters()` — production-shaped, generous thresholds — and its continued passing is the "no regression to existing auth flows" coverage.

Automatic user provisioning (EPIC-006 Sprint 6.4):

- `backend/src/users/userService.test.ts` — new `getOrProvisionFromAuth` coverage: creates a profile with the given id/email and `displayName: null`, idempotent on a repeated call for the same id (no duplicate row), and leaves an already-existing profile untouched (never overwrites its email).
- `backend/src/routes/auth.test.ts` — new coverage: first login for a brand-new Supabase-Auth-verified identity auto-provisions its `public.users` row; an existing user's login is unaffected (no re-provisioning, no email overwrite); repeated logins for the same first-time user don't duplicate rows; several concurrent first-login requests for the same new user race-safely produce exactly one row; a token that fails verification (invalid JWT) still 401s and provisions nothing; wrong credentials still 401 and provision nothing.
- `backend/src/auth/mockAuthProvider.test.ts`, `backend/src/auth/supabaseAuthProvider.test.ts` — updated/new coverage for `VerifiedAccessToken.email`: `MockAuthProvider.signInWithPassword`'s issued token verifies back to the real email; `SupabaseAuthProvider.verifyAccessToken` returns the JWT's `email` claim and rejects a token with no `email` claim.

Live-provider verification (EPIC-004 Sprint 4.9), the non-mock pass `RISK-001` was waiting on:

- `backend/src/auth/jwt.test.ts` — new ES256 fixtures/coverage (`generateEcKeyPairWithJwk`, `signEs256Jwt`) alongside the existing RS256 coverage, all renamed from `verifyJwtRs256` to `verifyJwtSignature`: valid ES256 token accepted, signature mismatch rejected, unknown `kid` rejected, and an RS256 token rejected against an EC-only JWKS.
- Manual live verification (not a committed automated test — see `backend/src/routes/auth.test.ts` for the automated equivalent against `MockAuthProvider`/a fake Supabase HTTP layer): real HTTP requests via `curl` against a locally running backend (`AUTH_PROVIDER=supabase`, pointed at the live project) for login, authenticated request, session listing, refresh + rotation, refresh-reuse rejection, rate-limit `429`, logout, and post-logout refresh rejection. All behaved per this requirement's acceptance criteria; see the Sprint 4.9 status paragraph above for the one bug this surfaced and its fix.

## Related Implementation

Foundation layer (EPIC-004 Sprint 4.4) plus live integration (EPIC-004 Sprint 4.5), implementing `ADR-0022` exactly:

- `database/migrations/0020_auth_sessions.sql` — local session/device storage.
- `backend/src/auth/types.ts`, `errors.ts`, `jwt.ts` — the `AuthProvider` abstraction and standards-based RS256/ES256 JWKS verification (`verifyJwtSignature`; RS256-only at first, widened to also accept ES256 in Sprint 4.9 once a live Supabase project's real tokens revealed it as the current default).
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

Authentication rate limiting (EPIC-004 Sprint 4.7), completing acceptance criterion 5 (`ADR-0023`):

- `backend/src/middleware/rateLimit.ts` (new) — `RateLimiter` (a small in-process, in-memory fixed-window counter; no Redis or other distributed store, justified by `ARCH-001` §3's "single backend service" architecture), `rateLimitMiddleware` (the Express middleware factory), `authRateLimitConfigFromEnv` (reads `AUTH_LOGIN_RATE_LIMIT_MAX`/`_WINDOW_MS`, `AUTH_LOGIN_IP_RATE_LIMIT_MAX`/`_WINDOW_MS`, `AUTH_REFRESH_RATE_LIMIT_MAX`/`_WINDOW_MS` with safe defaults — same shape as `createAuthProviderFromEnv`), `ipKey`/`normalizeEmail` (key helpers).
- `backend/src/routes/auth.ts` — `POST /auth/login` is rate-limited both by normalized email (primary) and by source IP (backstop); `POST /auth/refresh` by source IP. Over-limit requests get `429` + `Retry-After` before credentials are even checked; a successful login/refresh resets that request's counters. `AuthPublicRouterDependencies` (a new interface extending `AuthRouterDependencies`) requires all three `RateLimiter` instances — required, not optional, mirroring `authProvider`'s "no safe default that keeps the app secure if omitted" rationale.
- `backend/src/app.ts` — added `authRateLimiters` as an optional `AppDependencies` field; `authPublicRouter` now only mounts when both `sessionService` and `authRateLimiters` are present, so the public auth surface can never ship without its abuse protection. Also sets `app.set('trust proxy', 1)` so `req.ip` resolves the real caller behind `ARCH-001` §8's recommended hosting platforms' edge proxies (Fly.io/Render/Vercel), not the proxy's own address.
- `backend/src/index.ts` — constructs the three `RateLimiter` instances from `authRateLimitConfigFromEnv()` and passes them into `createApp`.

Automatic user provisioning (EPIC-006 Sprint 6.4), closing the identity-mapping gap `ADR-0022` v1.0 left as a manual step:

- `backend/src/auth/types.ts` — `VerifiedAccessToken` gains `email: string`, resolved from the same verified token no callers need a second lookup for.
- `backend/src/auth/supabaseAuthProvider.ts` — `verifyAccessToken` now extracts and requires the JWT's `email` claim (Supabase always includes it on the password-grant tokens this provider issues).
- `backend/src/auth/mockAuthProvider.ts` — `issueMockTokens` gains an optional `email` parameter (backward-compatible; existing positional `ttlMs` callers unaffected), `signInWithPassword` passes the real email through, and `verifyAccessToken` decodes it back out.
- `backend/src/users/userService.ts` — new `getOrProvisionFromAuth(id, email)`: reads an existing profile if one exists; otherwise inserts `id`/`email`/`display_name: NULL` via `INSERT ... ON CONFLICT (id) DO NOTHING`, then reads back the row either way (idempotent, race-safe under concurrent first logins for the same new subject; never overwrites an already-existing profile).
- `backend/src/routes/auth.ts` — `POST /api/auth/login` calls `getOrProvisionFromAuth` instead of `getUser`, removing the `UserNotFoundError` → 401 branch entirely (a verified identity can no longer fail login purely for lacking a local profile).

## Related Governance Records

[`ECIA-001`](../governance/ECIA-001-authentication-foundation.md) (Authentication Foundation — Implementation Planning). [`RISK-001`](../governance/RISK-001-unauthenticated-endpoints.md) (Every Backend Endpoint Is Reachable Without Authentication), registered as a direct consequence of this requirement not yet being implemented; closed in Sprint 4.9 once this requirement's live-verification condition was met.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.8 | 2026-08-02 | EPIC-006 Sprint 6.4 (Automatic User Provisioning): fixed a real production login failure — a correctly-authenticated Supabase Auth user with no matching `public.users` row was rejected with a generic 401, because `ADR-0022` v1.0's identity-mapping reconciliation was a manual step that was never carried out for the live project. `POST /api/auth/login` now auto-provisions the profile on first login (`UserService.getOrProvisionFromAuth`, idempotent and race-safe); `VerifiedAccessToken` gained `email`. See `ADR-0022` v1.1. No acceptance criterion changed; this closes an operational gap in how the already-decided identity mapping gets established. Status remains `Implemented`. |
| 1.7 | 2026-08-01 | EPIC-004 Sprint 4.9 (Live Verification): verified all five acceptance criteria against a real, active Supabase project rather than only the mock-fixture test suite. Found and fixed a real bug — `verifyJwtRs256` rejected every token the live project actually issues, since it signs with ES256 (EC/P-256), not RS256; generalized to `verifyJwtSignature`, supporting both. No other defect found; login, authorization, session refresh/rotation, refresh-reuse rejection, rate limiting, and logout/revocation all behaved correctly end to end. Closes `RISK-001`. Status remains `Implemented` (criteria were already met on paper; this sprint confirms they hold against the real vendor, not just mocks). |
| 1.6 | 2026-08-01 | EPIC-004 Sprint 4.7 (Authentication Rate Limiting): added `backend/src/middleware/rateLimit.ts` (`RateLimiter`, an in-process/in-memory fixed-window counter — no Redis, justified by `ARCH-001` §3's single-instance architecture; see `ADR-0023`) and wired it into `POST /api/auth/login` (rate-limited by email and by IP) and `POST /api/auth/refresh` (by IP), with `429`/`Retry-After` responses and reset-on-success. All five `REQ-001` acceptance criteria are now met. **Status moves from `Approved` to `Implemented`.** No `ADR-0022` change; `ADR-0023` newly decides the rate-limiting mechanism `REQ-001-PLAN` had left open. |
| 1.5 | 2026-08-01 | EPIC-004 Sprint 4.6 (Authentication API Surface): built the client-accessible HTTP layer — `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:sessionId`. Extended `AuthProvider` with `signInWithPassword` (both `MockAuthProvider` and `SupabaseAuthProvider`), extended `SessionService` with `getSession`/`findByRefreshToken`, added `AuthLoginFailedError`. Wired `sessionService` into `app.ts` (optional dependency, mirroring the `proactiveIntelligenceService` pattern) and `index.ts`. Acceptance criteria 1–4 are now met; criterion 5 (rate limiting) remains unmet. Status stays `Approved`, not `Implemented`. No `ADR-0022` change, no new provider, no invented OAuth flow — this sprint implements login mechanics the already-decided provider (Supabase Auth) natively supports. |
| 1.4 | 2026-08-01 | EPIC-004 Sprint 4.5 (Authentication Integration): wired `requireAuth`/`requireWorkspaceOwnership` into every `/api` route in `backend/src/app.ts` (except the public OAuth callback), added `requireUserOwnership` for `/users/:userId`-shaped routes, fixed a malformed-workspace-id 500 the wiring would otherwise have introduced, and changed `POST /workspaces` to derive the owner from the authenticated caller instead of a client-supplied body field. Adapted all 17 existing route test suites to attach real tokens; added explicit new coverage for missing/invalid/expired tokens and cross-user access. Acceptance criterion 1 is now met; criteria 3–4 are partially met (mechanism wired, no login/refresh/devices HTTP endpoints yet); criterion 5 remains unmet. Status stays `Approved`, not `Implemented`. No `ADR-0022` change — this sprint implements the already-decided design, it does not revise it. |
| 1.3 | 2026-08-01 | EPIC-004 Sprint 4.4 (Authentication Implementation Foundation): built the `AuthProvider` abstraction (mock + Supabase), JWT/JWKS verification, session lifecycle (`SessionService`, `auth_sessions` migration), and `requireAuth`/`requireWorkspaceOwnership` middleware — all implementing `ADR-0022` exactly. Updated Related Tests/Related Implementation with real paths. Status stays `Approved`, not `Implemented`: nothing is yet wired into `app.ts` or an existing route, so no acceptance criterion is met in production terms yet. |
| 1.2 | 2026-08-01 | Added `ADR-0022` (Authentication Architecture) reference following EPIC-004 Sprint 4.3. No change to Status, Acceptance Criteria, or scope — the ADR decides *how* this requirement will be implemented, not whether it's required. |
| 1.1 | 2026-08-01 | Added planning cross-references (`REQ-001-PLAN`, `ECIA-001`, `RISK-001`) following EPIC-004 Sprint 4.2 (Authentication Foundation Planning). No change to Status, Acceptance Criteria, or scope — planning only, no code written. |
| 1.0 | 2026-08-01 | Initial requirement, formalizing `ARCH-001`'s existing, not-yet-built authentication design. |
