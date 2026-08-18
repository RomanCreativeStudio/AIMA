# ADR 0025: First Production Hosting Platform & Database Host

**Document ID:** ADR-0025
**Status:** Decided
**Date:** 2026-08-02
**Owner:** Lead Software Architect
**Reviewer:** Product owner
**Related Architecture:** `ARCH-001` §8 "Technology Recommendations" (Hosting/deployment, Database, Auth rows), §9 "Security Considerations"
**Related Requirements:** None formally tracked — this is infrastructure, not a functional requirement.
**Related Documents:** `docs/PRODUCTION_SETUP.md` (`DEPLOY-001`), `docs/DEPLOYMENT_CHECKLIST.md`, `docs/decisions/0016-production-deployment-foundation.md` (`ADR-0016`), `docs/decisions/0022-authentication-architecture.md` (`ADR-0022`), `docs/decisions/0024-database-security-boundary.md` (`ADR-0024`), `docs/governance/RISK-002-postgrest-public-schema-exposure.md`, `docs/governance/RISK-003-no-backup-restore-capability.md`

## Context

`ARCH-001` §8 named candidate hosting platforms ("e.g., Fly.io, Render, or Vercel") and a candidate database approach ("managed, e.g., Supabase or a managed Postgres host") without choosing between them — the same kind of deliberately-open category `ADR-0022` later resolved for the auth provider. `ADR-0016` (Phase 3.1) built everything needed to deploy — Dockerfile, config validation, health checks, logging — explicitly without standing up a live deployment or choosing a host. `ADR-0022` Decision 1 was explicit that the auth provider and the database *host* are separate, independently-selectable infrastructure decisions in this architecture, even though it picked Supabase Auth as the auth provider. Nothing in this codebase has picked a database host or a compute host yet. EPIC-006 exists to make and act on those choices; this ADR makes them.

## Problem

Two concrete questions need decided answers before a first deployment can happen:

1. Where does the production Postgres database run?
2. Where does the containerized backend (the `Dockerfile` this project already has) run?

Both must satisfy `ARCH-001` §8's guiding rule: favor a managed service over self-hosted infrastructure, because a solo developer's time is the scarcest resource, not infrastructure spend.

## Decision

> **Amended 2026-08-02 (v1.1) — see Revision History.** Point 1 below originally decided a *new, dedicated* Supabase project for production. That could not be executed: the organization's free tier caps active projects at 2, and both slots were already held by this codebase's existing dev/test project (`cjdkijgwvirbbdkbtgjy`) and an unrelated project (a separate site's booking backend) that must not be touched. Given that constraint, the product owner directed reusing the existing `cjdkijgwvirbbdkbtgjy` project for both development and Version 1 rather than upgrading the org to a paid plan or pausing the dev/test project. Point 1's text below has been updated to reflect the decision actually in effect; the original reasoning for wanting a dedicated project is preserved in the amendment note in Trade-offs, not deleted, per `CONST-001` Article X.

1. **Database host: the existing `cjdkijgwvirbbdkbtgjy` ("AIMA") Supabase project's own Postgres**, connected to directly via `DATABASE_URL` (not through PostgREST) — the same access pattern `ADR-0024` already assumes and secures (PostgREST's `anon`/`authenticated` grants revoked; the backend uses its own privileged role). This project already carries this codebase's dev/test environment and prior live-verification sprints' history (EPIC-004 Sprint 4.9, EPIC-005 Sprints 5.1–5.6); as of this amendment it is reused for Version 1 production too, rather than standing up a separate dedicated project (see amendment note above and Trade-offs). Verified before this amendment shipped: the project's `public` schema already carries all 24 tables matching every migration through `0020_auth_sessions.sql` (spot-checked `auth_sessions`' exact column set), `pgcrypto`/`vector` are installed, and `anon`/`authenticated` hold zero grants on any `public` table (`information_schema.role_table_grants` returned empty) — `RISK-002`'s mitigation is still in effect, unprompted by this amendment. `ADR-0022`'s decoupling of auth provider from database host still holds architecturally (either could change independently later, and nothing in the codebase hardcodes this project's reference — `DATABASE_URL`/`AUTH_PROVIDER_URL`/`AUTH_PROVIDER_API_KEY` are the only places it appears, all environment-injected, verified by a repo-wide search finding zero hardcoded occurrences outside `.env`-style files and narrative documentation).

2. **Compute host: Render**, deploying the existing root `Dockerfile` unmodified as a Web Service. Render was chosen over the other two `ARCH-001` §8 candidates:
   - **Fly.io** — a credible, architecture-compatible alternative (same Dockerfile would work unchanged) but requires a CLI and a `fly.toml` to get a first deployment running; more operational surface for equivalent benefit at this stage.
   - **Vercel** — built for serverless/edge functions and static/Next.js frontends, a poor fit for a long-running Express process holding a persistent Postgres connection pool (`backend/src/db/pool.ts`); its listed use in `ARCH-001` §8 was always for a future, separate Next.js web dashboard client, not this backend.

   Render supports a Dockerfile-based Web Service with no CLI or config file required: connect the GitHub repo, point it at the root `Dockerfile`, set environment variables through its dashboard, and it builds and deploys automatically on push. It provides free automatic TLS on both a `*.onrender.com` subdomain and any later custom domain, and its own health-check-gated zero-downtime deploys — which the existing `HEALTHCHECK` (`GET /health`, `EPIC-005` Sprint 5.4) already satisfies without modification, verified against a real Docker daemon in `EPIC-005` Sprint 5.5.

3. **Domain & TLS**: launch on Render's free `*.onrender.com` HTTPS subdomain — it already satisfies `PUBLIC_BACKEND_URL`'s `https://` requirement (`loadConfig()`, `ADR-0016`) with zero DNS setup. A custom domain is a later, purely operational Render-dashboard change (DNS CNAME + automatic Let's Encrypt certificate) — no application code or architecture change either way, so it is not a blocker for first launch.

4. **Backup mechanism**: Supabase's own built-in automated Postgres backups (daily backups / point-in-time recovery, available on Supabase's paid plans — not the free tier) are the primary, scheduled backup for the production database, since Supabase is now the database host and this is a managed-service-over-self-hosted-infrastructure choice consistent with `ARCH-001` §8's guiding rule. `database/backup.sh`/`restore.sh` (`EPIC-005` Sprint 5.6, `RISK-003`) remain the documented manual/emergency-recovery path and the fallback scheduling mechanism (e.g., a scheduled GitHub Action) if the operator chooses to stay on Supabase's free tier instead — that specific cost/ops trade-off is left to the operator to decide at deployment time (`docs/DEPLOYMENT_CHECKLIST.md` §8), not decided here.

## Alternatives Considered

- **A separate managed Postgres host (Render Postgres, Neon, Fly Postgres) instead of Supabase's own Postgres** — rejected for the first deployment: it would add a second vendor relationship, a second dashboard, and a second TLS/connection configuration for no offsetting benefit, since Supabase is already the decided auth provider (`ADR-0022`) and its Postgres already ships this schema's required extensions.
- **Fly.io as the compute host** — not rejected outright, flagged as a credible fallback: the Dockerfile is host-agnostic (verified against a real Docker daemon, `EPIC-005` Sprint 5.5), so switching later is a hosting-platform change, not an architecture change, if Render's free/starter tier proves insufficient.
- **A self-hosted VPS (e.g., a bare DigitalOcean droplet)** — rejected per `ARCH-001` §8's explicit guiding rule favoring managed services; would trade a small cost saving for real operational burden (OS patching, TLS renewal, process supervision) a solo developer's time budget doesn't support.

## Trade-offs

- **Vendor concentration**: both auth and database now depend on Supabase being available and correctly configured. Mitigated structurally the same way `ADR-0022` already mitigates auth-provider vendor risk — the `AuthProvider` interface abstraction — and the database access layer is already provider-agnostic (`createPool()` takes any Postgres connection string); switching database hosts later is a `DATABASE_URL`/`DATABASE_SSL` change, not a rewrite.
- **Supabase's free tier lacks automated backups.** Getting real backup coverage may mean a paid Supabase plan, an added recurring cost this ADR surfaces but does not eliminate — `docs/DEPLOYMENT_CHECKLIST.md` §8 requires this be a deliberate decision, not a default.
- **Render's free tier can idle/sleep a low-traffic service**, which would make `/health` briefly unreachable and delay the first request after inactivity — acceptable for a personal-use MVP's first launch; upgrading to Render's paid always-on tier is a dashboard setting, not an architecture change, if this proves disruptive.
- **No environment isolation at the Supabase layer (added in v1.1).** Dev and Version 1 production now share one Auth user pool and one Postgres — a bug exercised against dev could touch the same tables and Auth users a real production user is in, and `AUTH_PROVIDER_URL`/`AUTH_PROVIDER_API_KEY` are identical between the two environments (only `DATABASE_URL`'s value, if a separate local Postgres is still used for pure local dev, and `CREDENTIAL_ENCRYPTION_KEY`, which must never be shared regardless, differ). This is the reason a dedicated project was the original v1.0 decision; it is accepted now only because of the org's project cap, not because the risk stopped being real. Mitigated the way the product owner directed: nothing references this project by name/ref outside environment variables (verified, Decision 1), so promoting to a dedicated project later is a configuration change — new Supabase project, new env var values in Render — not a code or architecture change. Pre-launch cleanup of this project's one existing sprint-verification Auth user is tracked as a manual step in `docs/PRODUCTION_SETUP.md` §10, not done by this ADR.

## Consequences

- `docs/PRODUCTION_SETUP.md` §10 operationalizes this decision into an ordered, actionable list.
- As of this amendment, the database is already migrated and already secured (verified, Decision 1) — the checklist's database-setup and security-configuration steps are complete for this project, not merely planned. What remains is Auth production hardening (e.g., enabling leaked-password protection, currently off) and pre-launch test-data cleanup, both tracked in the checklist.
- No code, schema, or architecture change was required by either the original decision or this amendment — every prerequisite it depends on (`Dockerfile`, `loadConfig()`, `HEALTHCHECK`, graceful shutdown, backup/restore tooling, environment-variable-only provider/project configuration) already existed and was verified in `EPIC-005`.

## Risks

- Both chosen vendors (Supabase, Render) are external dependencies; an outage in either blocks new logins/deploys respectively. This is the same accepted trade-off `ADR-0022` already made for Supabase Auth specifically, extended here to the database — building and maintaining either in-house is a worse trade for a solo developer than a rare vendor outage.
- No risk register entry is warranted for this ADR itself — it is a forward-looking infrastructure choice, not a discovered gap or exposure (contrast `RISK-002`/`RISK-003`, which recorded gaps already found and fixed).

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-02 | Initial decision: Supabase (new, dedicated production project) as database host, Render as compute host, `*.onrender.com` for initial TLS, Supabase automated backups as the primary backup mechanism. |
| 1.1 | 2026-08-02 | Amended Decision 1: creating a new dedicated Supabase project failed (org capped at 2 free projects, both already held by the existing dev/test project and an unrelated project). Product owner directed reusing the existing `cjdkijgwvirbbdkbtgjy` project for both development and Version 1 instead of upgrading the org plan or pausing dev/test. Verified the project is already fully migrated and already has `RISK-002`'s PostgREST revocation in effect, and that nothing in the codebase hardcodes this project's reference. Added the resulting no-environment-isolation trade-off. Compute host (Render), domain/TLS, and backup-mechanism decisions are unaffected. |
