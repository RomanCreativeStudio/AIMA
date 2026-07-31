# AIMA Production Setup Guide

**Document ID:** DEPLOY-001
**Document Name:** AIMA Production Setup
**Version:** 0.1.0
**Status:** Active
**Authority Level:** Operational; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Lead Software Architect
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`
**Dependents:** Release process, incident response, monitoring documentation
**Review Frequency:** Every deployment or infrastructure change
**Last Updated:** 2026-07-31
**Related Documents:** [`docs/PRODUCT_BIBLE.md`](PRODUCT_BIBLE.md), [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md), [`docs/README.md`](README.md)

---

**Version:** 0.1
**Status:** Official Engineering Reference — companion to `docs/DEVELOPMENT_SETUP.md` and `docs/decisions/0016-production-deployment-foundation.md`
**Last Updated:** 2026-07-28

This document covers what `docs/DEVELOPMENT_SETUP.md` doesn't: running the AIMA backend somewhere other than a developer's own machine. It describes the production deployment foundation shipped in Phase 3.1 — configuration validation, logging, error monitoring, database TLS/pooling, and health checks — and how to configure them. It does **not** provide real OAuth credentials, a hosting account, or a live deployment; those are outside what this environment can do (same boundary Phase 2.7 drew for live OAuth testing — see `docs/decisions/0015-live-integration-providers.md`).

---

## 1. What "production" changes

The backend behaves identically in every environment except for a small set of checks and output formats gated on `NODE_ENV`:

| Concern | Development / test | Production (`NODE_ENV=production`) |
|---|---|---|
| `PUBLIC_BACKEND_URL` | Any URL, including `http://` | Must start with `https://` — `loadConfig()` throws otherwise |
| Log format | Human-readable text (`[LEVEL] message fields`) | Single-line JSON per entry, parseable by a log platform |
| Database TLS | Off by default | Set `DATABASE_SSL=true` for managed Postgres providers |
| Everything else (routes, permission enforcement, workspace isolation, approval gating) | Identical | Identical — there is no separate "production code path" |

The guiding rule (`docs/DEVELOPMENT_SETUP.md` §1) still applies: the simplest thing that satisfies the requirement, not a parallel production-only implementation.

---

## 2. Environment variables

`backend/.env.production.example` is the production template — copy it to `backend/.env` (or, better, load these into your host's environment/secret store directly rather than shipping a `.env` file) and fill in real values.

All variables `backend/.env.example` documents are required in every environment; production adds no new *required* variable, only stricter validation of existing ones (`PUBLIC_BACKEND_URL`) and a couple of previously-optional ones you'll actually want to set:

| Variable | Required | Production guidance |
|---|---|---|
| `NODE_ENV` | No (defaults to `development`) | Set to `production`. Enables JSON logging and the `PUBLIC_BACKEND_URL` HTTPS check. |
| `PORT` | No (defaults to `4000`) | Match whatever your hosting platform expects, or leave default and let it map externally. |
| `CORS_ORIGINS` | No (defaults to deny-all) | Set to your real client origin(s), comma-separated. Never `*`. |
| `DATABASE_URL` | Yes | Your managed Postgres connection string. |
| `DATABASE_SSL` | No (defaults to `false`) | Set to `true` for managed providers (Supabase, Render, Fly Postgres — see §3). |
| `DATABASE_POOL_MAX` | No (defaults to `10`) | Raise only if your Postgres plan's connection limit and expected concurrency call for it. |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Base64, must decode to exactly 32 bytes (`openssl rand -base64 32`). Store in a secret manager, not a plain env var file, where your host supports one. |
| `PUBLIC_BACKEND_URL` | Yes | Must be `https://` in production — this is the OAuth redirect target; a plaintext callback would leak authorization codes in transit. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Yes | From a real Google Cloud OAuth app (see `docs/DEVELOPMENT_SETUP.md` §5) — registering one is outside this environment's scope, so these remain placeholders until you do. |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | Yes | From a real GitHub OAuth app, same caveat. |
| `AI_PROVIDER`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_MODEL` | No (defaults to `mock`) | Set `AI_PROVIDER=claude` and a real key for a live deployment; `mock` never calls out. |
| `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` (+`_API_KEY`/`_MODEL`/`_TIMEOUT_MS`) | No (defaults to `mock`) | Set both to `openai` and an OpenAI API key for real voice transcription/synthesis (Phase 3.3); `mock` never calls out. |

`loadConfig()` (`backend/src/config/env.ts`) is the single source of truth for every one of these checks — it fails fast at process startup with a descriptive error rather than letting a missing or malformed variable surface as a confusing runtime error later, the same philosophy the Foundation Sprint established.

---

## 3. Database (production)

`createPool()` (`backend/src/db/pool.ts`) takes an optional `{ ssl, maxConnections }` beyond the connection string:

- **`DATABASE_SSL=true`** negotiates TLS with `rejectUnauthorized: false`. Most managed Postgres providers (Supabase, Render, Fly Postgres) present a certificate that isn't chained to a public CA even though the connection itself is fully encrypted — this is a deliberate, documented tradeoff, not a security gap: the connection is encrypted, just not identity-verified against a public root.
- **`DATABASE_POOL_MAX`** bounds simultaneous connections so a traffic spike can't exhaust the database's own connection limit (many managed Postgres plans cap total connections in the tens, not hundreds).

Run the migrations in `database/migrations/` against your production database exactly as you would locally (`database/README.md`) — there is no separate production migration path.

---

## 4. Logging

`backend/src/logging/` provides a `Logger` interface (`debug`/`info`/`warn`/`error`) with `ConsoleLogger` as the default implementation — mirroring the same provider-abstraction pattern as `AIProvider`/`EmbeddingProvider`/`OAuthProvider`. Nothing in the codebase depends on `ConsoleLogger` directly; a future hosted logging service (Datadog, Better Stack, etc.) is a drop-in `Logger` implementation with no call-site changes.

- **Format**: human-readable in development/test, single-line JSON in production (`{"level","message","timestamp",...fields}`) — parseable by any log-shipping agent that tails stdout.
- **Redaction**: every field passed to the logger is recursively scanned (`backend/src/logging/redact.ts`) and any key whose name contains `secret`, `token`, `password`, `credential`, `authorization`, `apikey`, `api_key`, or `privatekey` (case-insensitive) has its value replaced with `[REDACTED]` — this guarantees OAuth tokens, the credential encryption key, and similar secrets can never end up in log output by accident, regardless of what a caller passes in.
- **Request logging**: `requestLogger` middleware (`backend/src/middleware/requestLogger.ts`) logs one line per request (`method`, `path`, `statusCode`, `durationMs`) once the response finishes.
- **Wiring**: `createApp()` builds a `ConsoleLogger` automatically if none is injected (`AppDependencies.logger` is optional), so no existing test file needed updating for this phase.

---

## 5. Error monitoring

`backend/src/monitoring/` provides an `ErrorReporter` interface (`captureException(error, context?)`) with `ConsoleErrorReporter` as the default — it logs the exception (message + stack) via the injected `Logger`, so redaction applies here too. This is the same "framework now, live account later" pattern Phase 2.7 used for OAuth: registering a real hosted error tracker (Sentry, Bugsnag, etc.) means implementing `ErrorReporter` and injecting it — no change to `ExecutionService`, routes, or anything else that might throw.

The terminal error-handling middleware (`backend/src/middleware/errorHandler.ts`, `createErrorHandler(errorReporter)`) reports every unhandled error this way before responding with a generic 500 — callers never see internal error details, consistent with the existing security posture.

---

## 6. Health monitoring

`GET /health` (`backend/src/health/healthService.ts`) now reports five independent checks: `database`, `aiProvider`, `memory`, `knowledge`, and (new in Phase 3.1) `integrations`.

The `integrations` check reports which of Gmail/GitHub/Calendar have an OAuth provider registered — computed from the real `oauthProviders` map `index.ts` already builds from `GOOGLE_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_ID` etc., not a raw re-check of environment variables. Like the existing `aiProvider` check, this is deliberately shallow — configuration-presence only, never a live network call to Google or GitHub — because a health endpoint that might be polled every few seconds should not incur a third-party network round-trip on every poll (the same reasoning `docs/decisions/0006-assistant-core-orchestration.md` gives for the AI provider check).

The `voiceProviders` check (Phase 3.3) reports the configured speech-to-text/text-to-speech provider names (e.g. `openai / openai`) the same way — no live call, since a non-`mock` provider missing its API key already fails at process startup (`ai-engine/src/voice/registry.ts`), before `HealthService` ever runs.

A missing integration provider reports `{"status":"error","detail":"Not configured: <providers>"}` on that one check without masking the others — `database`/`memory`/`knowledge`/`aiProvider` can still read `ok` independently, so a health dashboard can tell at a glance which subsystem needs attention.

---

## 7. Deployment (Docker)

A production-ready multi-stage `Dockerfile` lives at the repo root (built from the repo root, since this is an npm-workspaces monorepo and `backend` depends on the sibling `@aima/ai-engine` package):

```
docker build -t aima-backend .
docker run -p 4000:4000 --env-file backend/.env aima-backend
```

The build stage installs full dependencies and runs `npm run build` (compiling both `ai-engine` and `backend`); the production stage installs only production dependencies (`npm ci --omit=dev`) and copies in the compiled `dist/` output plus `database/` migrations — no TypeScript, dev tooling, or source ships in the final image. `.dockerignore` excludes `node_modules`, `dist` (rebuilt inside the image), `.git`, `.env*` (except the `.example` templates), and the Swift `apps/` client code, which is irrelevant to the backend image.

This `Dockerfile` has been reviewed for correctness but not executed end-to-end in this environment (no Docker daemon available here) — verify a real `docker build .` succeeds in your own environment before relying on it.

---

## 8. Security review (Phase 3.1)

A review pass over the areas most likely to matter once this backend is internet-reachable, confirming what's already true rather than introducing new mechanisms:

- **Credential encryption** — integration OAuth tokens are encrypted at rest with AES-256-GCM (`AesGcmCredentialEncryptor`, Phase 2.3), keyed by `CREDENTIAL_ENCRYPTION_KEY`. Phase 3.1 moved the key's 32-byte-length validation into `loadConfig()` itself, so a malformed key now fails at process startup with a clear message instead of only when the encryptor is first used.
- **OAuth token handling** — access/refresh tokens are never returned to any client; the macOS app only ever sees connection status (`connected`/`expired`/`disconnected`), never a token value. Tokens are redacted from logs by key-name pattern (§4) as a defense-in-depth measure on top of never being logged intentionally.
- **Workspace isolation** — every service method that reads or writes workspace-scoped data takes an explicit `workspaceId` and filters by it at the query layer (not just in application logic); this predates Phase 3.1 and was not changed, only re-verified against the current route set.
- **Permission enforcement** — every action-producing route continues to call `PermissionEngine` before executing, and every executed action is written to `action_log`; unchanged this phase, re-verified.
- **Approval enforcement** — every Tier 3 capability continues to require an `approved` `pending_approvals` row before `ExecutionService` will execute it; unchanged this phase, re-verified.
- **Transport security** — the only new enforcement this phase: `PUBLIC_BACKEND_URL` must be `https://` in production, since OAuth providers redirect real users (with authorization codes in the query string) to this URL.

No new vulnerability class was introduced or found; this section documents what was checked, not a remediation list.

---

## 9. What this phase does not do

Per the explicit Phase 3.1 scope:
- Does not require, register, or hardcode real Google/GitHub OAuth credentials.
- Does not stand up a live deployment, hosting account, or managed database.
- Does not add background sync, webhooks, or autonomous execution.
- Does not change any existing route's request/response shape.

Registering real OAuth apps and deploying to a reachable host remains Integration Sprint scope (`docs/TECHNICAL_ARCHITECTURE.md` §10) — this phase makes that step configuration-ready, not complete.
