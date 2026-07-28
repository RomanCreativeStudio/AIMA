# ADR 0016: Production Deployment Foundation

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §8, §9, `docs/PRODUCTION_SETUP.md`, `backend/src/config/`, `backend/src/logging/`, `backend/src/monitoring/`, `backend/src/db/pool.ts`, `backend/src/health/`

## Context

Through Phase 2.7, AIMA's backend ran identically everywhere — a developer's own machine was the only environment it had ever needed to support. Phase 3.1 asked for the backend to become production-ready: deployment configuration, environment validation, secret management structure, production database configuration, logging, error monitoring, OAuth production readiness, deployment docs, a security review, and extended health checks — explicitly **without** requiring real OAuth credentials, a hosting account, or a live deployment. As with Phase 2.7's OAuth framework built before any real OAuth app existed, the task is to make the *shape* of production operation correct and testable now, so that plugging in a real host, a real Postgres provider, and real OAuth apps later requires configuration, not a rewrite.

## Decisions

### 1. `NodeEnv` is a closed, validated union — not a free string

`loadConfig()` (`backend/src/config/env.ts`) now validates `NODE_ENV` against a fixed `NODE_ENVS = ['development', 'test', 'production']` tuple, throwing a descriptive error on anything else (a typo like `NODE_ENV=prod` fails fast at startup instead of silently behaving like development). This mirrors the existing fail-fast philosophy for every other required variable, and gives every other Phase 3.1 decision (JSON logging, the HTTPS check) a single, typed source of truth to branch on instead of ad hoc string comparisons scattered across the codebase.

### 2. `CREDENTIAL_ENCRYPTION_KEY`'s byte-length check moved from the encryptor's constructor into `loadConfig()`

The check itself already existed (`AesGcmCredentialEncryptor`'s constructor, Phase 2.3) and already ran at startup via `index.ts`, so this is not a new fail-fast guarantee — it's the same guarantee moved to live alongside every other startup validation, in one place, independently testable without constructing an encryptor, and with an error message in the same style as the rest of `loadConfig()`.

### 3. `PUBLIC_BACKEND_URL` must be `https://` when `NODE_ENV=production` — the only new *behavioral* production check

This is deliberately the sole check that actually branches on environment (every other Phase 3.1 addition — logging format, the `integrations` health check — changes output, not validation outcome). The reasoning is narrow and concrete: `PUBLIC_BACKEND_URL` is where Google/GitHub redirect a real user's browser after OAuth consent, with an authorization code in the query string; over plaintext HTTP that code is interceptable in transit. Development and test keep accepting `http://127.0.0.1:...` unchanged, since there's no real user or real authorization code to protect there.

### 4. `Logger`/`ErrorReporter` follow the exact provider-abstraction precedent `AIProvider`/`OAuthProvider` already established

`backend/src/logging/types.ts` and `backend/src/monitoring/types.ts` each define a minimal interface; `ConsoleLogger`/`ConsoleErrorReporter` are the only implementations, and every call site depends on the interface, never the concrete class. This is not a new pattern invented for this phase — it's the same shape as `ai-engine`'s `AIProvider`/`EmbeddingProvider` and Phase 2.7's `OAuthProvider`: build the seam now, let a real hosted service (a log platform, Sentry-equivalent) slot in later as a drop-in implementation with zero call-site changes. `docs/PRODUCTION_SETUP.md` §4–5 documents this explicitly as "framework now, live account later," the same language ADR 0015 used for OAuth.

### 5. `Logger`/`ErrorReporter` are optional dependencies with internal defaults — not new required constructor arguments

`AppDependencies.logger`/`AppDependencies.errorReporter` are optional; `createApp()` constructs a `ConsoleLogger`/`ConsoleErrorReporter` internally when neither is supplied. This was a deliberate change from how Phase 2.6/2.7 handled comparable additions (`ExecutionService`, `OAuthService`), where a new required dependency meant updating every one of ~15 existing route test files' `AppDependencies` object by hand. Making the new dependency optional-with-a-safe-default means the same backward compatibility with zero mechanical test-file changes this phase — every existing test file that builds `AppDependencies` continues to compile and pass unmodified.

### 6. Secret redaction is by key-name pattern, applied inside the logger — not left to caller discipline

`backend/src/logging/redact.ts` recursively scans any object passed to `ConsoleLogger` and replaces the value of any key whose name contains `secret`, `token`, `password`, `credential`, `authorization`, `apikey`, `api_key`, or `privatekey` (case-insensitive substring match) with `[REDACTED]`. This is enforced centrally, at the logging boundary, rather than trusted to every call site remembering not to log a token — the same "make the unsafe thing structurally impossible, not just documented against" reasoning the Product Bible applies to permission tiers and workspace isolation.

### 7. The `integrations` health check mirrors actual OAuth wiring, not a raw re-check of environment variables

`HealthService`'s new `IntegrationReadiness` parameter is computed in `index.ts` from the real `oauthProviders` record already constructed there (`Boolean(oauthProviders.gmail)`, etc.), not from re-reading `GOOGLE_OAUTH_CLIENT_ID` directly. This keeps the check meaningful if OAuth provider registration is ever made conditional or partial in the future — it reports what's actually wired into the running process, not what the environment merely claims to contain. Like the pre-existing `aiProvider` check, it is deliberately shallow (configuration-presence only, no live call to Google/GitHub) for the same reason `docs/decisions/0006-assistant-core-orchestration.md` gives: a health endpoint that might be polled every few seconds should not incur a third-party network round-trip on every poll.

### 8. Database TLS and pool size are explicit, opt-in configuration — not inferred from `NODE_ENV`

`createPool()`'s new `{ ssl, maxConnections }` options are driven by their own env vars (`DATABASE_SSL`, `DATABASE_POOL_MAX`), not by `nodeEnv === 'production'`. A developer might run a local Postgres that requires TLS, or a production deployment against a provider that doesn't — tying database TLS to the environment name would be an incorrect proxy for the actual requirement (does *this specific* Postgres instance need TLS), so the two are kept orthogonal.

### 9. The Dockerfile builds from the repo root, not `backend/`

Because this is an npm-workspaces monorepo and `backend` depends on the sibling `@aima/ai-engine` package, a `Dockerfile` scoped to `backend/` alone cannot `npm ci` correctly — npm workspaces resolves sibling packages via the root `package.json`/`package-lock.json`. The multi-stage build therefore lives at the repo root, copies both workspace `package.json` files before `npm ci` (for Docker layer caching), then copies full source and runs `npm run build` (the root script that builds every workspace). The production stage repeats `npm ci --omit=dev` and copies in only the compiled `dist/` output and `database/` migrations — no TypeScript or dev tooling ships in the final image.

## Consequences

- `backend/`'s test suite grew from 451 tests (Phase 2.7's regression) to 484, with new coverage for `loadConfig()`'s production checks, `redact()`, `ConsoleLogger`'s format/redaction behavior, `ConsoleErrorReporter`, `requestLogger`, the `HealthService` `integrations` check, and a deployment-readiness check that `.env.example`/`.env.production.example` document every variable `loadConfig()` actually requires — catching future drift between the two automatically rather than relying on a developer remembering to update both files together.
- `apps/Shared/AIMACore`'s `SystemHealth` model gained the `integrations` field to stay an exact mirror of the backend's `GET /health` response shape, the same "one canonical shape, mirrored exactly" convention every prior phase's shared model has followed; `MockAPIClient.getHealth()` and the macOS Dashboard's status list were updated to match.
- No real Google/GitHub OAuth credentials were requested, registered, or hardcoded anywhere in this phase — every OAuth-shaped check added (`PUBLIC_BACKEND_URL`'s HTTPS requirement, the `integrations` health check) validates configuration *shape*, never reaches an actual provider.
- No live deployment, hosting account, or managed database was stood up — the Dockerfile has been reviewed for correctness but not executed against a real Docker daemon in this environment; `docs/PRODUCTION_SETUP.md` says so explicitly rather than implying a completed deployment.
- No background sync, webhooks, autonomous execution, or new route/response shape was introduced — this phase is entirely configuration, observability, and documentation, layered onto the exact same request-handling code every prior phase built.
