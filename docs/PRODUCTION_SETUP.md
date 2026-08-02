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
**Last Updated:** 2026-08-02
**Related Documents:** [`docs/PRODUCT_BIBLE.md`](PRODUCT_BIBLE.md), [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md), [`docs/README.md`](README.md), [`docs/decisions/0025-first-production-hosting.md`](decisions/0025-first-production-hosting.md)

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
| `AUTH_PROVIDER` | Defaults to `mock` (no credentials needed) | Must be `supabase` — `loadConfig()` throws if unset or `mock` (EPIC-005 Sprint 5.3; see §2 and §8) |
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
| `EMBEDDING_PROVIDER`, `EMBEDDING_PROVIDER_API_KEY`, `EMBEDDING_PROVIDER_MODEL` | No (defaults to `mock`) | Set `EMBEDDING_PROVIDER=openai` and a real key for real memory/knowledge/semantic retrieval; `mock` never calls out. Read directly by this backend process (`backend/src/index.ts`), not only by `ai-engine`'s own package use. |
| `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` (+`_API_KEY`/`_MODEL`/`_TIMEOUT_MS`) | No (defaults to `mock`) | Set both to `openai` and an OpenAI API key for real voice transcription/synthesis (Phase 3.3); `mock` never calls out. |
| `AUTH_PROVIDER`, `AUTH_PROVIDER_URL`, `AUTH_PROVIDER_API_KEY` | **Yes in production** (defaults to `mock`, which `loadConfig()` refuses to accept when `NODE_ENV=production`) | Set `AUTH_PROVIDER=supabase` plus your Supabase project's URL and anon/publishable key (`ADR-0022`). Unlike the mock AI/voice providers above, the mock auth provider is a security hole, not just degraded functionality — see §8. |
| `AUTH_LOGIN_RATE_LIMIT_MAX`/`_WINDOW_MS`, `AUTH_LOGIN_IP_RATE_LIMIT_MAX`/`_WINDOW_MS`, `AUTH_REFRESH_RATE_LIMIT_MAX`/`_WINDOW_MS` | No (safe built-in defaults, `ADR-0023`) | Override only if you have a specific reason to; the defaults (5/15min per-email login, 20/15min per-IP login and refresh) are production-safe as-is. |

`loadConfig()` (`backend/src/config/env.ts`) is the single source of truth for every one of these checks — it fails fast at process startup with a descriptive error rather than letting a missing or malformed variable surface as a confusing runtime error later, the same philosophy the Foundation Sprint established.

---

## 3. Database (production)

`createPool()` (`backend/src/db/pool.ts`) takes an optional `{ ssl, maxConnections }` beyond the connection string:

- **`DATABASE_SSL=true`** negotiates TLS with `rejectUnauthorized: false`. Most managed Postgres providers (Supabase, Render, Fly Postgres) present a certificate that isn't chained to a public CA even though the connection itself is fully encrypted — this is a deliberate, documented tradeoff, not a security gap: the connection is encrypted, just not identity-verified against a public root.
- **`DATABASE_POOL_MAX`** bounds simultaneous connections so a traffic spike can't exhaust the database's own connection limit (many managed Postgres plans cap total connections in the tens, not hundreds).

Run the migrations in `database/migrations/` against your production database exactly as you would locally (`database/README.md`) — there is no separate production migration path. `npm run db:migrate -- <production DATABASE_URL>` (`database/apply-migrations.sh`, EPIC-005 Sprint 5.4) applies every migration in order against a fresh database in one command; it is not a migration-tracking framework, so it's for the initial production setup, not incremental deploys against an already-migrated database. It runs as one `--single-transaction`, so a failed run rolls back completely rather than leaving a half-migrated database (EPIC-005 Sprint 5.6).

**Backup & restore:** `npm run db:backup` / `npm run db:restore` (`database/backup.sh` / `database/restore.sh`, EPIC-005 Sprint 5.6, full detail in `database/README.md`) wrap `pg_dump`/`pg_restore`, verified live against this schema including its pgvector columns. Neither script schedules or retains anything on its own — before real production data exists, either point a cron entry at `db:backup` or, preferred, enable the chosen managed Postgres provider's own automated-backup feature; as of this sprint, no such schedule is configured anywhere, so there is currently no standing backup of any real deployment's data.

**Startup behavior when the database is unreachable:** `main()` (`backend/src/index.ts`) syncs the capability registry into the `capabilities` table before the HTTP server starts listening — a real query, not just a config check. If the database is unreachable at boot, this throws, `main().catch()` logs the error and calls `process.exit(1)`, and the process never starts listening — verified live during this sprint's audit (`ECONNREFUSED` against a deliberately unreachable `DATABASE_URL` exits immediately with a clear message, no partial startup, no silently-unhealthy listener). This is deliberate fail-fast behavior, not a bug: an orchestrator's restart policy should handle this exactly like any other crash-on-boot.

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

The production stage (EPIC-005 Sprint 5.4) runs as the non-root `node` user `node:22-slim` already ships, rather than root, and declares a `HEALTHCHECK` that polls the same `GET /health` §6 describes (via Node's built-in `fetch`, so no `curl`/`wget` needs installing). The backend process itself also handles `SIGTERM`/`SIGINT` (`backend/src/index.ts`) — the signals `docker stop` and an orchestrator's rolling deploy both send — by stopping new connections, letting in-flight requests finish, and closing the database pool before exiting, rather than being killed mid-request.

This `Dockerfile`, unmodified, was built and run end-to-end in a real Docker daemon during EPIC-005 Sprint 5.5: `docker build .` succeeded, the container started as the non-root `node` user, `GET /health` returned `200` with every check passing, the `HEALTHCHECK` transitioned to `healthy`, and `docker stop` (SIGTERM) triggered the graceful-shutdown log line and a clean exit. The one environment-specific wrinkle: this development sandbox routes outbound HTTPS through a TLS-intercepting proxy that the container doesn't trust by default, so `npm ci` couldn't reach the registry until a throwaway build (extra CA cert, `--network host`) worked around it for verification purposes only — that workaround was never added to this `Dockerfile`, since a real host or CI runner has ordinary internet access and doesn't need it.

---

## 8. Security review (Phase 3.1)

A review pass over the areas most likely to matter once this backend is internet-reachable, confirming what's already true rather than introducing new mechanisms:

- **Credential encryption** — integration OAuth tokens are encrypted at rest with AES-256-GCM (`AesGcmCredentialEncryptor`, Phase 2.3), keyed by `CREDENTIAL_ENCRYPTION_KEY`. Phase 3.1 moved the key's 32-byte-length validation into `loadConfig()` itself, so a malformed key now fails at process startup with a clear message instead of only when the encryptor is first used.
- **OAuth token handling** — access/refresh tokens are never returned to any client; the macOS app only ever sees connection status (`connected`/`expired`/`disconnected`), never a token value. Tokens are redacted from logs by key-name pattern (§4) as a defense-in-depth measure on top of never being logged intentionally.
- **Workspace isolation** — every service method that reads or writes workspace-scoped data takes an explicit `workspaceId` and filters by it at the query layer (not just in application logic); this predates Phase 3.1 and was not changed, only re-verified against the current route set.
- **Permission enforcement** — every action-producing route continues to call `PermissionEngine` before executing, and every executed action is written to `action_log`; unchanged this phase, re-verified.
- **Approval enforcement** — every Tier 3 capability continues to require an `approved` `pending_approvals` row before `ExecutionService` will execute it; unchanged this phase, re-verified.
- **Transport security** — the only new enforcement this phase: `PUBLIC_BACKEND_URL` must be `https://` in production, since OAuth providers redirect real users (with authorization codes in the query string) to this URL.
- **Auth provider, not just database, security** (EPIC-005 Sprint 5.3) — `docs/decisions/0024-database-security-boundary.md` (`ADR-0024`) closed the database-level exposure; this pass found and closed the equivalent gap one layer up. `AUTH_PROVIDER` (EPIC-004) defaults to `mock` exactly like `AI_PROVIDER`/`EMBEDDING_PROVIDER`/the voice providers, but unlike those, `MockAuthProvider`'s "password" (`mockPasswordFor`) is a deterministic, publicly computable function of the email address alone — a mock AI provider running in production returns obviously-fake content, but a mock auth provider running in production would let anyone authenticate as anyone, silently. `loadConfig()` (`backend/src/config/env.ts`) now refuses to start when `NODE_ENV=production` and `AUTH_PROVIDER` is unset or `mock`, closing the gap structurally rather than relying on an operator remembering to set it (§1, §2).

No new vulnerability class was introduced or found; this section documents what was checked, not a remediation list.

---

## 9. What this phase does not do

Per the explicit Phase 3.1 scope:
- Does not require, register, or hardcode real Google/GitHub OAuth credentials.
- Does not stand up a live deployment, hosting account, or managed database.
- Does not add background sync, webhooks, or autonomous execution.
- Does not change any existing route's request/response shape.

Registering real OAuth apps and deploying to a reachable host remains Integration Sprint scope (`docs/TECHNICAL_ARCHITECTURE.md` §10) — this phase makes that step configuration-ready, not complete.

---

## 10. First Deployment Checklist (EPIC-006)

Everything above describes a backend that is *ready* to deploy; nothing has been deployed yet. This is the ordered, actionable checklist for actually doing that — hosting platform and database host are decided in `docs/decisions/0025-first-production-hosting.md` (`ADR-0025`); this section is the execution plan for that decision. Nothing here has been executed — every item is a prerequisite to complete before the first real deploy, not a record of one that happened.

### 1. Hosting platform

- [ ] Create a Render account, connect the GitHub repository.
- [ ] Create a new Render **Web Service** pointed at the repo root `Dockerfile` (no code change needed — verified building and running correctly against a real Docker daemon in `EPIC-005` Sprint 5.5).
- [ ] Set the service's health check path to `/health` (the same endpoint the Docker `HEALTHCHECK` already polls) so Render gates deploys on it.
- [ ] Confirm the service's port matches `PORT` (default `4000`) or let Render's port-detection handle it.

### 2. Domain / TLS

- [ ] Launch on Render's free `*.onrender.com` HTTPS subdomain — no DNS setup required, and it already satisfies `PUBLIC_BACKEND_URL`'s `https://` requirement (§2 above).
- [ ] Custom domain (optional, can be added later without any code change): add it in Render's dashboard, point a CNAME at Render, let Render issue the certificate automatically.

### 3. Production environment variables

Set every variable in `backend/.env.production.example` (§2 above) through Render's environment-variable dashboard — never commit a filled-in `.env`:

- [ ] `NODE_ENV=production`, `PORT`, `CORS_ORIGINS` (real client origin(s), never `*`).
- [ ] `DATABASE_URL` + `DATABASE_SSL=true` (from the new Supabase project — see §4).
- [ ] `CREDENTIAL_ENCRYPTION_KEY` — generate fresh with `openssl rand -base64 32`; never reuse the dev/test key.
- [ ] `PUBLIC_BACKEND_URL` — the real `https://` Render URL.
- [ ] `AUTH_PROVIDER=supabase` + `AUTH_PROVIDER_URL`/`AUTH_PROVIDER_API_KEY` (from the new Supabase project — see §5).
- [ ] `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` (see §6).
- [ ] `AI_PROVIDER`/`AI_PROVIDER_API_KEY`, `EMBEDDING_PROVIDER`/`_API_KEY`, `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` (+ their `_API_KEY`s) — decide per-provider whether to go live (`claude`/`openai`) or stay `mock` for launch; each is independently switchable later with no code change.
- [ ] Leave `AUTH_LOGIN_RATE_LIMIT_*`/`AUTH_REFRESH_RATE_LIMIT_*` at their defaults unless there's a specific reason to change them (`ADR-0023`).

### 4. Database setup

- [ ] Create the new, dedicated production Supabase project decided in `ADR-0025` — **do not reuse** the existing dev/test project (`cjdkijgwvirbbdkbtgjy`).
- [ ] Copy its Postgres connection string into `DATABASE_URL` (§3); confirm `pgvector`/`pgcrypto` are available (Supabase ships both by default).
- [ ] Run `npm run db:migrate -- <production DATABASE_URL>` once, from a trusted machine, against the empty new database — applies all 19 migrations atomically (`EPIC-005` Sprint 5.6's `--single-transaction` hardening).
- [ ] Revoke PostgREST's `anon`/`authenticated` grants on this new project exactly as `RISK-002`/`ADR-0024` did for the dev/test project — this is a *new* project, so the mitigation has not been applied to it yet and must be redone, not assumed:
  ```sql
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  ```
- [ ] Verify the revocation: an unauthenticated `curl` against `https://<project>.supabase.co/rest/v1/users` with only the anon key should return `401`/`403`, never `200` (the exact check `RISK-002`'s Contingency Plan documents).

### 5. Supabase Auth production configuration

- [ ] In the new project's Auth settings, set the Site URL / redirect allow-list to the real `PUBLIC_BACKEND_URL` (and any client app URL once one exists).
- [ ] Decide and configure sign-up policy (open sign-up vs. invite-only) — this app has no self-serve sign-up UI yet (`AuthProvider` has no `signUp` method; users are provisioned directly), so initial user(s) must be created via Supabase's own dashboard/API, then given a matching row in this app's `users` table (`users.id` = the Supabase subject id, `ADR-0022` Decision 4).
- [ ] Confirm the project issues ES256 or RS256 JWTs (both supported, `backend/src/auth/jwt.ts`) — check via the project's JWKS endpoint if unsure.
- [ ] Do **not** set `AUTH_PROVIDER=mock` in this environment under any circumstance — `loadConfig()` already refuses to start that way in production (§1, §8), but the checklist calls it out because the consequence (anyone can authenticate as anyone) is severe enough to double-check by hand.

### 6. OAuth provider setup

- [ ] Register a real Google Cloud OAuth app (console.cloud.google.com/apis/credentials) with authorized redirect URIs `{PUBLIC_BACKEND_URL}/api/oauth/gmail/callback` and `{PUBLIC_BACKEND_URL}/api/oauth/calendar/callback`.
- [ ] Register a real GitHub OAuth app (github.com/settings/developers) with callback URL `{PUBLIC_BACKEND_URL}/api/oauth/github/callback`.
- [ ] Set the resulting client ID/secret pairs in Render's environment variables (§3).
- [ ] This is the one prerequisite `docs/PRODUCTION_SETUP.md` has explicitly deferred since Phase 3.1 (§9 above) as outside what this development environment can do — it requires a real account with each provider.

### 7. Migration process

- [ ] Already covered mechanically in §4 above (`npm run db:migrate`, one atomic run against the fresh database).
- [ ] For any *future* schema change after this first deployment: there is no incremental-migration tracking (`database/apply-migrations.sh` is documented as fresh-database-only, `database/README.md`) — apply new migration files by hand against the already-migrated production database (`psql -v ON_ERROR_STOP=1 -f <new-migration>.sql`), the same way local development always has.

### 8. Backup schedule

- [ ] Decide, deliberately (this is a real cost trade-off, not a default — `ADR-0025` Trade-offs): either (a) enable Supabase's built-in automated backups on the new project, which requires at least the Pro plan, or (b) stay on Supabase's free tier and self-schedule `npm run db:backup` (`database/backup.sh`, `EPIC-005` Sprint 5.6) via an external scheduler (e.g. a scheduled GitHub Action), storing the resulting dump somewhere durable (an S3-compatible bucket — this project does not yet have one wired up for this purpose).
- [ ] Whichever is chosen, confirm a restore actually works against this specific schema before relying on it — `database/restore.sh` was live-verified against a local database with pgvector data in `EPIC-005` Sprint 5.6; re-verify once against the real production project after the first backup exists.
- [ ] Until one of these is actually configured, there is no standing backup of production data — `RISK-003`'s mitigation built the tooling and verified it works, but scheduling it against a real deployment is this checklist's job, not something already done.

### 9. Monitoring

- [ ] Render's own health-check-gated deploys already cover "is the container healthy at deploy time" — no setup needed, uses the existing `/health`/`HEALTHCHECK` (§6, §7 above).
- [ ] Add an external uptime monitor (e.g. UptimeRobot, Better Stack — either has a usable free tier) polling the public `/health` endpoint, so a crash or outage between deploys pages someone instead of going unnoticed. Pure external configuration, no code change.
- [ ] Real error tracking (Sentry, Bugsnag, or similar) remains explicitly optional for first launch — `ErrorReporter` (§5 above) already logs every exception through the structured, redacted logger; wiring a hosted service is a drop-in `ErrorReporter` implementation whenever it's worth doing, not a blocker.

### What this checklist deliberately does not do

Per `ADR-0025` and the explicit instruction this checklist was written under: it does not itself create any account, provision any infrastructure, or deploy anything. Every box above is unchecked by design — this is the plan, not a record of execution.
