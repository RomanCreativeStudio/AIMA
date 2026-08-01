# RISK 002: Live Supabase Project Exposed the Public Schema via PostgREST

**Document ID:** RISK-002
**Status:** Closed
**Severity:** Critical
**Probability:** High
**Owner:** Lead Software Architect

## Description

The live Supabase project (`cjdkijgwvirbbdkbtgjy`) ran PostgREST (Supabase's auto-generated Data API) against the `public` schema with Row Level Security disabled on all 24 tables and Supabase's default `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` grants for the `anon` and `authenticated` roles left un-revoked. This is distinct from, and was discovered while investigating, the RLS-disabled advisory noted in EPIC-004 Sprint 4.9 — that sprint flagged the finding but did not test whether it was actually reachable. EPIC-005 Sprint 5.1 (`docs/decisions/0024-database-security-boundary.md`, `ADR-0024`) tested it directly: `curl` against `https://cjdkijgwvirbbdkbtgjy.supabase.co/rest/v1/users` using only the anon/publishable key (a key Supabase designs to be shipped in client apps — not a secret) returned `HTTP 200` with a valid response, confirming the exposure was real and live, not theoretical.

## Impact

Anyone holding the project's anon key — obtainable from any AIMA client binary/bundle once one exists, or simply known to anyone who has seen this project's Supabase configuration — could read and write every row of every table (`users`, `workspaces`, `conversations`, `messages`, `memory_records`, `auth_sessions`, `integration_credentials`, and all others) via a plain HTTP request to the project's REST endpoint, entirely bypassing `requireAuth`, `requireWorkspaceOwnership`, `PermissionEngine`, authentication rate limiting, and the `action_log` audit trail — every enforcement layer `REQ-001`/`RISK-001` closed at the application layer had no effect on this separate access path. `auth_sessions` (refresh-token hashes) and `integration_credentials` (encrypted OAuth material) being reachable this way would have materially compromised `ADR-0022`'s session-revocation model and `ADR-0011`'s integration-credential encryption boundary, respectively, had either table held real data at the time of discovery (neither did — both were empty).

## Detection Method

Not caught by automated monitoring — discovered by directly testing the live project's PostgREST endpoint during EPIC-005 Sprint 5.1's database security boundary audit, prompted by re-investigating the RLS-disabled advisory Sprint 4.9 had flagged but not acted on. Supabase's own security advisor (`get_advisors`, security category) independently flags this class of finding (`rls_disabled_in_public`, tagged `"facing": "EXTERNAL"` by Supabase itself) and remains a standing, low-cost detection signal for any future regression — see Contingency Plan.

## Mitigation Strategy

Revoke the `anon`/`authenticated` roles' grants on the `public` schema rather than adopt Row Level Security — `ADR-0024` records the full reasoning for why RLS is not the right tool for this codebase's database-access model (the backend is the only application-code caller, using a role distinct from and not constrained by `anon`/`authenticated`). Applied directly against the live project as part of this same investigation:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
```

The `ALTER DEFAULT PRIVILEGES` statements make this durable against future migrations — a new table added by `database/migrations/00NN_*.sql` is closed to `anon`/`authenticated` by default, not exposed until a future, deliberate `GRANT`.

## Contingency Plan

If a future audit or Supabase advisor scan shows `anon`/`authenticated` holding grants on any `public` table again (a regression — e.g., from a manual `GRANT` applied without awareness of this project's architecture), re-run the revocation statements above and re-verify via a direct, unauthenticated `curl` against `/rest/v1/<table>` that the response is `401`/`403` `permission denied`, not `200`. If evidence emerges that the exposure window (project creation through this fix) was actually accessed by an unauthorized party, treat every row in `auth_sessions` as compromised (force-revoke all sessions) and every row in `integration_credentials` as compromised (rotate `CREDENTIAL_ENCRYPTION_KEY` and every connected OAuth provider's tokens), mirroring `RISK-001`'s existing contingency plan for the same categories of data.

## Related ADRs

`ADR-0024` (Database Security Boundary) — the decision and investigation that found and closed this risk. `ADR-0022` (Authentication Architecture) — the application-layer authorization model this risk's exposure bypassed entirely.

## Related Requirements

`REQ-001` (Authentication) — not itself unmet by this risk (its acceptance criteria concern the application's own HTTP API, which this exposure bypassed rather than broke), but the risk directly undermined `REQ-001`'s practical security guarantee by giving unauthenticated callers a path around it.

## Related Architecture

`ARCH-001` §3 "Backend Architecture" ("The API layer is the only component allowed to talk to the database... Clients never call the... database directly") — the principle this risk's exposure violated in the live project's configuration (not in application code, which already complied). `ARCH-001` §9 "Security Considerations" → "API Security", "Data Protection".

## Related ECIA

None registered yet.

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.1 | 2026-08-01 | Lead Software Architect | Mitigation applied and verified within the same investigation (EPIC-005 Sprint 5.1): `anon`/`authenticated` grants revoked on the live project; a direct, unauthenticated `curl` against `/rest/v1/users` confirmed `HTTP 200` → `HTTP 401`, and the same request bearing a real, freshly issued `authenticated`-role access token confirmed `HTTP 200` → `HTTP 403`. `information_schema.role_table_grants` confirmed zero remaining grants. Status moves `Confirmed` → `Closed`. |
| 1.0 | 2026-08-01 | Lead Software Architect | Initial identification and confirmation, during EPIC-005 Sprint 5.1's database security boundary audit: direct testing (not just the Supabase advisor's static finding) proved the live project's `public` schema was reachable and writable via the anon key through PostgREST, with RLS disabled and default `anon`/`authenticated` grants intact. |
