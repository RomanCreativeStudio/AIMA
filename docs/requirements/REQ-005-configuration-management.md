# REQ 005: Configuration Management

**Document ID:** REQ-005
**Status:** Approved
**Priority:** High
**Category:** Non-Functional

**Owner:** Product owner

## Purpose

Fail fast and loudly on misconfiguration, instead of letting a missing or malformed environment variable surface as a confusing runtime error deep inside a request handler.

## Description

The backend loads and validates its configuration from environment variables once, at startup, via `loadConfig()` (`backend/src/config/env.ts`), producing a typed `AppConfig` object. Production deployments get additional, stricter checks (`ARCH-001` §"Production Deployment Foundation (Phase 3.1)", decided in `ADR-0016`) — for example, a real `https://` callback URL is required in production because OAuth providers redirect real users there with authorization codes.

## Acceptance Criteria

1. `loadConfig()` reads `process.env` into a typed `AppConfig` object covering `port`, `nodeEnv`, `databaseUrl`, `databaseSsl`, `databasePoolMax`, `corsOrigins`, `credentialEncryptionKey`, `publicBackendUrl`, and the Google/GitHub OAuth client credentials.
2. A missing required variable (e.g. `DATABASE_URL`) throws at `loadConfig()` time, not later when first used.
3. `CREDENTIAL_ENCRYPTION_KEY` is validated as a 32-byte value at config load time (moved there from inside the encryptor's constructor, so the failure surfaces at startup).
4. `NODE_ENV` is validated against a fixed set (`development` / `test` / `production`); an unrecognized value is rejected.
5. Production-only checks apply when `nodeEnv === 'production'` — `PUBLIC_BACKEND_URL` must be `https://` in that case.
6. The set of environment variables `loadConfig()` requires stays in sync with what `.env.example` / `.env.production.example` document — verified by `backend/src/config/deploymentReadiness.test.ts`, which cross-checks the two rather than duplicating validation logic in a separate implementation file.

## Dependencies

None registered yet.

## Related ADRs

`ADR-0016` — Production Deployment Foundation.

## Related Architecture

`ARCH-001` §"Production Deployment Foundation (Phase 3.1)".

## Related Tests

`backend/src/config/env.test.ts`, `backend/src/config/deploymentReadiness.test.ts`.

## Related Implementation

`backend/src/config/env.ts`. (There is no separate `deploymentReadiness.ts` implementation file — the deployment-readiness check is a test-only cross-check against `.env.example`/`.env.production.example`.)

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial requirement, formalizing the existing Configuration Management implementation (Phase 3.1). |
