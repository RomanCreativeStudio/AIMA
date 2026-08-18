# ADR 0015: Live Integration Providers

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3, §4, §5, `backend/src/oauth/`, `backend/src/integrations/`, `backend/src/execution/`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Through Phase 2.6, every provider connector was a deterministic stub — no real OAuth app, no real HTTP call to Gmail/GitHub/Calendar — an explicit, repeatedly-documented scope cut (ADR 0011, ADR 0014) because registering a real OAuth app and completing a consent flow was outside what those phases asked for. Phase 2.7 asked for the opposite: production-ready API clients, a full OAuth 2.0 framework (authorization, token exchange, refresh, secure storage, rotation, disconnect cleanup), and three additional Calendar write actions — while still running in an environment with no real Google/GitHub OAuth app registered and no live network access to test against, and with an explicit requirement that tests mock every external call.

The central tension: "production-ready" and "no live network calls in tests" are not in conflict once separated correctly — the *code* calling Gmail's/GitHub's/Calendar's real REST APIs can be genuinely production-ready (real endpoints, real request/response shapes, real error handling) while every test injects a fake `fetch` and never leaves the process. This ADR is mostly about the shape of that separation, plus a handful of storage/architecture decisions OAuth specifically requires that stub credentials never did.

## Decisions

### 1. Every live connector and OAuth provider takes an injectable `fetch`, defaulting to the global implementation

`GoogleGmailConnector`, `LiveGitHubConnector`, `GoogleCalendarConnector`, `GoogleOAuthProvider`, and `GitHubOAuthProvider` all accept a `fetchFn: typeof fetch = fetch` constructor parameter. Production code never passes it (the global `fetch` is used, matching `ai-engine`'s `OpenAIEmbeddingProvider` precedent of calling a provider's REST API directly rather than through an SDK). Every test passes a fake one (`backend/src/testUtils/fakeFetch.ts`, a small queued-response double recording every call), so genuinely real request construction (headers, query params, JSON bodies, base64url message encoding) is exercised without a real network call. This is the mechanism that resolves the central tension above.

### 2. The OAuth redirect URI is a single fixed backend URL, not a per-request or client-supplied one

Rather than have the macOS app run a local loopback listener (RFC 8252's native-app pattern) or accept an arbitrary client-supplied `redirect_uri`, every provider's authorized redirect URI is one fixed backend route: `{PUBLIC_BACKEND_URL}/api/oauth/:provider/callback`, registered once with each provider's OAuth app (`docs/DEVELOPMENT_SETUP.md`'s new "OAuth Configuration" section). This is the standard "authorization code flow for a server-side app" shape: the provider redirects the user's browser straight to the backend, which completes the token exchange itself and renders a small static confirmation page — no client-side redirect handling, deep link, or local server exists anywhere in this codebase. The macOS app's only job is to open `POST .../oauth/:provider/start`'s returned URL in the system browser and, afterward, refresh its own view of `listIntegrations` — there is no polling in between (`docs/PRODUCT_BIBLE.md`'s "no automatic execution," extended here to "no automatic polling").

### 3. OAuth state is a short-lived, in-memory CSRF token — not a new database table

`OAuthService` keeps pending authorization attempts (`state -> {workspaceId, provider, expiresAt}`) in a plain in-memory `Map`, not a persisted table. A `state` is single-use, expires in ten minutes, and exists purely to prevent a forged or replayed callback from connecting the wrong workspace — it carries no information a client ever needs back, and losing pending flows on a backend restart (an edge case: restarting mid-consent-screen) is an acceptable, deliberate tradeoff rather than infrastructure this system doesn't otherwise need. This mirrors the codebase's general bias toward the simplest storage that satisfies the actual requirement, the same reasoning `docs/decisions/0011...`'s stub connectors and this ADR's Decision 5 (below) both lean on.

### 4. Token refresh happens transparently inside `IntegrationService.getDecryptedCredentials` — `ExecutionService`/`WorkflowService` needed no changes

Per the phase's explicit item 6 ("`ExecutionService` must invoke live providers without API changes"), token rotation is implemented entirely inside `IntegrationService`: `getDecryptedCredentials` checks the stored `expiresAt` (with a 60-second buffer) and, only if a registered `OAuthProvider` and a refresh token both exist, calls `refreshAccessToken` and persists the result before returning fresh credentials. Every existing caller (workflow handlers, `ActionExecutor`s) is completely unaware this happens — they called `getDecryptedCredentials` before Phase 2.7 and call it identically now. This is the same "push new behavior behind an existing seam" approach ADR 0012 used for approval-gating a workflow step: the capability was already there, only its interior got smarter.

### 5. A non-secret `token_expires_at` column, separate from the encrypted credentials

The credential material itself (`accessToken`/`refreshToken`/`expiresAt`-as-string) stays exactly where Phase 2.3 put it: encrypted, inside `integration_credentials`. But Phase 2.7's macOS requirement ("Token expiration" as a UI affordance) needs the *expiry timestamp specifically* — not the token — visible to a client without ever decrypting anything. Rather than expose a decrypt path from a route (which would break the "credentials never leave `IntegrationService`" invariant every prior phase has held), `database/migrations/0015_oauth_token_expiry.sql` adds one plain, non-secret `workspace_integrations.token_expires_at` column, kept in sync by `connect`/`rotate`/the transparent refresh in Decision 4, and surfaced on the existing `WorkspaceIntegration` model with no new route.

### 6. GitHub's non-expiring classic OAuth token is handled as a real, valid case — not an error

Classic GitHub OAuth Apps issue access tokens with no expiration and no refresh token by default; only apps that have opted into "token expiration" get `expires_in`/`refresh_token` back. `GitHubOAuthProvider.exchangeCode`/`refreshAccessToken` both treat `expires_in`/`refresh_token` as optional and pass through whatever the response actually contains, and `IntegrationService`'s refresh logic treats a missing `expiresAt` as "never expires" rather than attempting a refresh that would fail. This means GitHub's connection can go on working indefinitely without ever hitting the refresh path, correctly, rather than needing a special-cased "GitHub is different" branch anywhere else in the system.

### 7. Three new Calendar write capabilities and executors, following the exact GitHub-write precedent from Phase 2.6

`create_calendar_event`/`update_calendar_event`/`delete_calendar_event` are registered as Tier 3, tier-locked capabilities, each with a matching `ActionExecutor` (`CalendarCreateEventExecutor`/`CalendarUpdateEventExecutor`/`CalendarDeleteEventExecutor`), mirroring `create_github_issue`/`create_github_pull_request`'s treatment in ADR 0014 exactly — a new provider's first write actions get their own capabilities and executors rather than reusing or overloading an existing one. Calendar's pre-existing `read_calendar` capability continues to gate all read methods (`listCalendars`, `listEvents`) generically, unchanged from Phase 2.3 — only the new writes needed new gates.

### 8. `IntegrationRegistry.writeCapability` widened to `writeCapabilities: string[]`

Phase 2.6 added two write capabilities to GitHub without updating this registry field (it stayed a single optional string, still describing only `draft_gmail_email` for Gmail and nothing for GitHub) — a gap that would have only gotten worse once Calendar's three new write capabilities landed this phase with nowhere to go. Widening the field to a list is the minimal change that lets the Integrations screen's capability display actually reflect every write action a provider supports, for all three providers, going forward.

## Consequences

- Real HTTP request/response shapes for Gmail (`gmail.googleapis.com`), GitHub (`api.github.com`), and Google Calendar (`www.googleapis.com/calendar/v3`) are implemented and tested against fakes — replacing these with a live network call needs no further connector-shape changes, only removing the `fetchFn` override in tests (which were never removed from production code to begin with).
- `backend/`'s test suite grew from 383 tests (Phase 2.6's regression) to 451, with the addition of `oauth/` (Google/GitHub OAuth provider tests, `OAuthService` tests against a real Postgres transaction), three new live-connector test files, three new calendar executor tests, `routes/oauth.test.ts`, and extended `IntegrationService`/`connectors`/`registry` tests for token refresh, disconnect revocation, and the widened write-capability list.
- `apps/Shared/AIMACore` gained `WorkspaceIntegration.tokenExpiresAt`, `APIClient.startIntegrationOAuth`, and `IntegrationsViewModel.startOAuthConnection` — the OAuth flow's client-side surface is intentionally thin, since the backend does the actual OAuth work.
- The macOS Integrations screen's primary "Connect" action now opens the system browser to a backend-issued authorization URL rather than presenting a credential-entry form first; manual credential entry (`CredentialEntrySheet`, Phase 2.3) remains available as a secondary option, unchanged, for backward compatibility.
- No background sync, push notifications, webhooks, automatic polling, or autonomous execution exist or are implied by this phase — token refresh is triggered synchronously by the request that needs it, never on a timer; the macOS app's "Refresh Status" is a manual, explicit, one-shot fetch, not a poll loop.
