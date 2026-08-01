# ADR 0022: Authentication Architecture

**Document ID:** ADR-0022
**Status:** Decided
**Date:** 2026-08-01
**Owner:** Lead Software Architect
**Reviewer:** Product owner
**Related Architecture:** `ARCH-001` §"Authentication" (Core Architecture Components), §5 "Permission Architecture", §6 "Workspace Architecture", §8 "Technology Recommendations", §9 "Security Considerations"
**Related Requirements:** `REQ-001` (Authentication), `REQ-003` (Workspace Management)
**Related Documents:** `docs/requirements/REQ-001-implementation-plan.md` (`REQ-001-PLAN`), `docs/governance/ECIA-001-authentication-foundation.md`, `docs/governance/RISK-001-unauthenticated-endpoints.md`, `docs/requirements/RTM.md`

## Context

`ARCH-001` already decided the shape of AIMA's authentication — a managed provider, session-based access + refresh tokens, per-device revocation, rate-limited auth endpoints (§"Authentication", §9) — but left the specific provider, token model, and integration mechanics undecided. `REQ-001-PLAN.md` (Sprint 4.2) analyzed the current state and surfaced the real, present gap: no authentication code exists anywhere in the backend, and every endpoint — including workspace-scoped ones — trusts the caller-supplied identifier with no ownership check (`RISK-001`). That planning pass deliberately left open: which specific provider, whether access tokens are self-contained or opaque, where device/session state lives, and how identity maps onto AIMA's existing `users` table.

This ADR resolves those open questions. It does not revisit `ARCH-001`'s own decisions (managed provider, session-based tokens, device revocation, rate limiting) — it operationalizes them.

## Problem

Before authentication can be implemented, five concrete questions need decided answers, not just a design direction:

1. Which managed auth provider, and why — given `ARCH-001` §8 names three examples (Supabase Auth, Clerk, Auth0) without choosing between them?
2. Are access tokens self-contained (JWT, verified locally) or opaque (verified against the provider on every request)?
3. Where does device/session metadata live, so the "signed in devices" requirement (`ARCH-001` §"Authentication") can be served without a provider round-trip on every read?
4. How does a provider-issued identity map onto AIMA's existing `users.id`?
5. When an authenticated caller requests a workspace they don't own, what does the system do — and does that answer already have a precedent in this codebase?

## Decision

1. **Provider strategy:** Adopt an `AuthProvider` interface abstraction, mirroring the pattern already used throughout this codebase for every other external capability (`AIProvider`, `EmbeddingProvider`, `SpeechToTextProvider`/`TextToSpeechProvider`, `OAuthProvider`) — a small interface AIMA's own code depends on, with a concrete implementation selected by configuration. **Supabase Auth is decided as the first concrete implementation.** It is Postgres-native (matching AIMA's already-decided database technology, `ADR-0001`), is `ARCH-001` §8's first named example, issues JWT access tokens and refresh tokens without additional integration work (directly satisfying `ARCH-001`'s already-decided session model), and provides first-party device/session APIs. This decision is independent of, and does not commit AIMA to, any specific choice of Postgres *host* — the auth provider and the database host are separate infrastructure decisions in this architecture, exactly as `EMBEDDING_PROVIDER` and `AI_PROVIDER` are independently selectable today.
2. **Token/session model:** Access tokens are **JWT, self-contained, verified locally** against the provider's published signing key (JWKS) — no network call to the provider on ordinary API requests. Refresh tokens are **opaque**, held server-side, and are the actual revocation lever (see Decision 3). Access tokens are short-lived (target: 15 minutes); refresh tokens are longer-lived with **rotation on every use** — each refresh issues a new refresh token and invalidates the one just used; presenting an already-rotated refresh token is treated as a compromise signal for that session.
3. **Device/session revocation:** AIMA's own database (not the provider) is the source of truth for the "signed in devices" list — a local session/device record (device label, created-at, last-seen, a hash of the current refresh token identifier) is created at login and updated on each refresh. Listing devices is a local read, no provider call. Revoking a device deletes/marks that local record; the next refresh attempt against a revoked session is rejected. This is a decision about *what* is tracked and *where*, not a schema — no table is created by this ADR (see Constraints).
4. **Identity mapping:** AIMA's existing `users.id` (UUID, `backend/src/users/types.ts`) **is** the provider's subject identifier — no separate mapping column. This keeps `UserService`/`WorkspaceService` unchanged (per `REQ-001-PLAN`'s "User Identity Flow" analysis) and matches the single-account, 1:1 identity relationship this system actually has. The one implementation-time consequence: any pre-existing seeded `users` row must have its `id` reconciled with the provider's subject ID for that same person during rollout (Consequences, below) — this ADR decides the mapping strategy, not the migration mechanics.
5. **Workspace authorization enforcement:** After auth middleware resolves a verified caller identity, every workspace-scoped route handler checks that the target workspace's `userId` matches the resolved caller before proceeding, and returns the **same "not found" response for both "doesn't exist" and "belongs to another user"** — this is not a new convention invented for auth; it is the existing pattern this codebase already uses (`WorkspaceNotFoundError`, shared across `backend/src/users/`, `backend/src/workspaces/`, and other services since Phase 1.5; the same identical-treatment principle `ARCH-001` §4 documents for `ApprovalEngine`'s "doesn't exist" vs. "belongs to another workspace" isolation). Authentication and the Permission Engine remain separate concerns, unchanged from `REQ-001-PLAN`'s analysis: auth answers "is this a legitimate caller," `PermissionEngine.evaluate` still answers "is this action allowed to happen automatically," with no identity parameter added to its signature.
6. **Security boundaries:** The **account boundary** (new, this ADR) is enforced by auth middleware sitting in front of every route. The **workspace boundary** (existing, `ARCH-001` §6, DB-level `workspace_id` partitioning) is unchanged in mechanism — it now sits behind an authenticated, authorized caller instead of an open one. The **capability/tier boundary** (existing, `ARCH-001` §5, `PermissionEngine`) is unchanged and orthogonal, per Decision 5.

## Alternatives Considered

- **Self-built credential system** (password hashing, custom JWT issuance/rotation) — rejected. Directly contradicts `ARCH-001` §8's explicit guidance ("don't build auth in-house") and its guiding rule that solo-developer time is the scarcest resource; more security-critical surface to get right, for no benefit this system needs.
- **Clerk** — rejected as the first implementation. Clerk's strength is prebuilt web UI components; AIMA's primary clients are native SwiftUI (macOS/iPhone), not a web-embedded product, so that strength doesn't transfer. It is also a vendor entirely separate from Postgres, adding operational surface without a corresponding benefit for this project's shape. Not eliminated as a future alternative if Supabase Auth proves unsuitable.
- **Auth0** — rejected as the first implementation. Enterprise-oriented configuration and pricing model, heavier than a single-account personal assistant needs. Same "kept as a fallback" status as Clerk.
- **Opaque access tokens, verified against the provider on every request** — rejected. Adds a network round-trip and an external dependency to every single API call, directly working against the "low operational overhead" and responsiveness goals `ARCH-001` §8 states. JWT with a short expiry gets acceptable revocation latency (Trade-offs) without that per-request cost.
- **No local session/device table; rely entirely on the provider's own session-listing API** — rejected. Would make the "signed in devices" UI dependent on a live provider call every time it's opened, adding latency and a new failure mode, and breaks from this codebase's established pattern of keeping user-facing reads local and shallow (e.g. `HealthService`'s deliberately shallow, no-live-call provider checks).

## Trade-offs

- **Revocation latency is bounded, not instant, for access tokens.** Because access tokens are self-contained JWTs verified locally, revoking a device stops new refreshes immediately but a still-valid access token keeps working until it naturally expires (target: up to 15 minutes). This is accepted — it's the standard trade-off of local JWT verification, and the alternative (opaque, provider-verified tokens) costs latency and an external dependency on every request in exchange for instant revocation this system's threat model doesn't require.
- **A managed auth provider is an external dependency for login.** If Supabase Auth has an outage, new logins and refreshes fail (already documented as a Failure Scenario in `REQ-001-PLAN`); already-issued access tokens keep working until they expire, since verification is local. Accepted for the same reason `ARCH-001` §8 already accepted this trade-off for every other external capability in this system — building and maintaining auth in-house to avoid a rare vendor outage is a worse trade for a solo developer.
- **A new, additive table AIMA fully owns** (device/session metadata) is anticipated, consistent with how every other feature in this system has added tables (Decision 3). This is a small, ordinary maintenance surface, not a new category of complexity.

## Consequences

- Every existing route test that constructs an unauthenticated request (`users.test.ts`, `workspaces.test.ts`, and the rest) will need a decided fixture/bypass strategy before or during implementation — already flagged in `REQ-001-PLAN`'s Testing Strategy, reaffirmed here as a direct consequence of this decision, not a new finding.
- `backend/src/config/env.ts` will need new configuration once implemented (provider project URL, JWKS/public key source, service-role key) — following the existing fail-fast `loadConfig()` pattern (`REQ-005`), not created by this ADR.
- `UserService`, `WorkspaceService`, and `PermissionEngine` do not need internal changes — only the routing layer gains an authorization check in front of them, per Decision 5 and `REQ-001-PLAN`'s "Identity Flow" analysis.
- Rollout must reconcile any pre-existing seeded `users` row's `id` with the corresponding provider subject ID (Decision 4) — a one-time, implementation-time migration concern, not resolved here.
- `RISK-001` (every endpoint currently unauthenticated) is not closed by this ADR — it is closed only once implementation actually ships. This ADR is the decision that makes that implementation possible to start.

## Risks

- **Revocation-latency window** (Trade-offs, above): an attacker with a stolen, still-valid access token retains access for up to the token's remaining lifetime after a device is revoked. Mitigated by keeping the expiry short (15 minutes); accepted, not eliminated.
- **Vendor dependency risk**: Supabase Auth becoming unavailable, discontinued, or unsuitable at scale would require a provider migration. Mitigated structurally by the `AuthProvider` interface abstraction (Decision 1), which is exactly the pattern this codebase already uses to keep `AI_PROVIDER`/`EMBEDDING_PROVIDER`/voice providers swappable — a provider change would not require rewriting `UserService`/`WorkspaceService`/route authorization logic.
- **Identity-mapping migration risk** (Decision 4, Consequences): getting the one-time `users.id` reconciliation wrong at rollout could lock out the existing seeded account. Flagged explicitly for implementation-time attention; no mitigation beyond "do not treat this as a trivial step" is decided here, since the actual migration mechanics are implementation, not architecture.
- `RISK-001` remains open and Confirmed until implementation ships — this ADR does not change its status.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial decision: Supabase Auth via an `AuthProvider` abstraction, JWT access + opaque rotating refresh tokens, locally-owned device/session records, `users.id`-as-subject-ID identity mapping, and uniform not-found-style workspace authorization enforcement. |
