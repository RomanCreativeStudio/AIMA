# RISK 001: Every Backend Endpoint Is Reachable Without Authentication

**Document ID:** RISK-001
**Status:** Mitigating
**Severity:** Critical
**Probability:** High
**Owner:** Lead Software Architect

## Description

No authentication exists anywhere in the backend (confirmed by repository audit: `backend/src/middleware/` contains only request logging and error handling; `backend/src/app.ts`'s middleware stack has no auth check; `UserProfile` has no credential field). Every route — including `GET/PATCH /api/workspaces/:workspaceId`, which resolves purely from the URL parameter — is reachable by anyone who can reach the API, with no check that the caller has any relationship to the resource requested.

This is not a hypothetical future risk: it is the system's actual, present state, confirmed while producing `REQ-001-PLAN.md` (`docs/requirements/REQ-001-implementation-plan.md`).

## Impact

Anyone with network access to a deployed AIMA backend could read or modify any workspace's data — tasks, memory, preferences, drafts, conversations — by guessing or obtaining a workspace UUID, with no credential required. In a single-user MVP deployed only to `localhost`/a trusted network, the practical exposure is currently low; the risk becomes severe the moment the backend is reachable from an untrusted network (e.g. a real deployment per `docs/PRODUCTION_SETUP.md`, `DEPLOY-001`).

**As of EPIC-004 Sprint 4.5, this specific impact no longer holds for any real endpoint** — see "Status as of EPIC-004 Sprint 4.5" below. This paragraph is preserved as the original finding, not rewritten, per `CONST-001` Article X.

## Detection Method

No automated detection exists today — there's nothing to authenticate, so there's no auth-failure log to alert on. Manual review: any request to a workspace-scoped endpoint without a credential currently succeeds; this is directly observable by inspecting `backend/src/app.ts`'s middleware stack or by issuing an unauthenticated request against a running instance.

## Mitigation Strategy

Implement `REQ-001` (Authentication), per `ARCH-001`'s existing design and `ADR-0022`'s decided provider (Supabase Auth), token model (JWT access + rotating opaque refresh), and workspace authorization enforcement. Until then: this risk is accepted for local/single-developer use (per `ARCH-001`'s explicit framing of authentication as protecting one account, not multi-tenant isolation), and any deployment beyond a trusted local network should not occur before `REQ-001` is implemented.

**Status as of EPIC-004 Sprint 4.4:** the mechanism this mitigation depends on now exists — `AuthProvider` verification/refresh/revocation, local session storage, and `requireAuth`/`requireWorkspaceOwnership` middleware (see `REQ-001`'s Related Implementation) — but none of it is wired into `backend/src/app.ts` or any existing route yet. Every endpoint described above remains reachable without authentication exactly as before; this risk's real-world exposure is unchanged. Wiring the middleware into the actual route stack is the next step toward closing this risk, not yet taken.

**Status as of EPIC-004 Sprint 4.5 (Authentication Integration):** the wiring described above as "not yet taken" is now in place. `backend/src/app.ts` gates every `/api` route behind `requireAuth`; every workspace-scoped route additionally behind `requireWorkspaceOwnership`, and every user-scoped route behind the new `requireUserOwnership`. An unauthenticated request to any real business endpoint now receives 401; a request for a workspace or user profile the caller doesn't own now receives the same 404 as a genuinely unknown resource. Verified by adapting all 17 existing route test suites to attach real tokens (every one still passes) plus new explicit tests for missing/invalid/expired tokens and cross-user access. The only route excluded from `requireAuth` is `GET /api/oauth/:provider/callback`, which cannot carry an AIMA-issued token by construction (it's a provider-driven external redirect) — its own authorization mechanism is the `state` parameter `OAuthService` issues and verifies, unchanged by this sprint. `GET /health` also remains public, matching ordinary infrastructure/monitoring convention. This closes the specific gap this risk registers: workspace/user data is no longer readable or modifiable by an uncredentialed caller. Status moves to `Mitigating`, not `Closed` — `REQ-001` acceptance criteria 3–5 (login/refresh/devices HTTP endpoints, rate limiting) are still open, and this risk should not be closed until those exist and a live-provider (non-mock) verification pass has been done.

## Contingency Plan

If a deployed instance is found to have been accessed without authorization: rotate `CREDENTIAL_ENCRYPTION_KEY` and all OAuth provider secrets (`backend/src/config/env.ts`), audit the `action_log` table for any Tier 3/4 actions taken during the exposure window, and treat every stored integration credential (`integration_credentials`) as potentially compromised.

## Related ADRs

`ADR-0022` (Authentication Architecture) — the decision that makes closing this risk possible to implement. This risk moved to `Mitigating` once that implementation shipped and was wired into every route (EPIC-004 Sprint 4.5); it remains open, not `Closed`, until `REQ-001`'s remaining acceptance criteria are met.

## Related Requirements

`REQ-001` (Authentication) — the direct mitigation. `REQ-003` (Workspace Management) — the specific endpoints this risk concerns.

## Related Architecture

`ARCH-001` §"Authentication", `ARCH-001` §9 "Security Considerations" → "API Security" ("All backend endpoints require authenticated, workspace-scoped requests; no anonymous or cross-workspace-by-default endpoints" — true as of EPIC-004 Sprint 4.5 for every route except the public health check and the provider-driven OAuth callback, both intentional, documented exceptions).

## Related ECIA

`ECIA-001` (Authentication Foundation — Implementation Planning), which surfaced this risk.

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.3 | 2026-08-01 | Product owner | EPIC-004 Sprint 4.5 (Authentication Integration): `requireAuth`/`requireWorkspaceOwnership`/`requireUserOwnership` are now live on every `/api` route except the public OAuth callback and health check. Status moves `Confirmed` → `Mitigating` — the exposure this risk registers no longer holds for any real endpoint, but the risk stays open until `REQ-001`'s remaining acceptance criteria (login/refresh/devices endpoints, rate limiting, live-provider verification) are met. |
| 1.2 | 2026-08-01 | Product owner | Noted EPIC-004 Sprint 4.4's foundation-layer implementation (`AuthProvider`, session handling, `requireAuth`/`requireWorkspaceOwnership` middleware) in Mitigation Strategy. Status remains `Confirmed`: nothing is wired into `app.ts`/any route yet, so real-world exposure is unchanged. |
| 1.1 | 2026-08-01 | Product owner | Added `ADR-0022` reference (Sprint 4.3) as the decision enabling mitigation. Status remains `Confirmed` — not resolved until implemented. |
| 1.0 | 2026-08-01 | Product owner | Initial identification, during `REQ-001` implementation planning (EPIC-004 Sprint 4.2). |
