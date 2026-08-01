# ECIA 001: Authentication Foundation — Implementation Planning

**Document ID:** ECIA-001
**Status:** Reviewed
**Date:** 2026-08-01
**Owner:** Lead Software Architect
**Reviewer:** Product owner

## Change Summary

This ECIA covers the *planning* phase for implementing `REQ-001` (Authentication) — no code, schema, or API was created. It analyzes the impact of eventually building authentication, so implementation can begin from a documented starting point rather than rediscovering these effects mid-build. A follow-up ECIA should be authored once implementation actually begins, covering the real, decided changes.

## Impact Analysis

- **Affected Requirements:** `REQ-001` (the subject of this planning pass). `REQ-002`/`REQ-003` (User/Workspace Management) will need an explicit authentication acceptance criterion once `REQ-001` is implemented — not changed by this ECIA. `REQ-004` (Permission Engine) is affected only in that its upstream caller becomes authenticated; the Permission Engine's own contract is unaffected (see `REQ-001-PLAN`'s "Permission Engine Integration").
- **Affected ADRs:** None. No architecture decision was made in this planning pass — see "Decisions" in the sprint report for why no new ADR was created.
- **Affected Architecture:** `ARCH-001` §"Authentication", §9 "Security Considerations". Not changed — this ECIA restates and plans against the existing design, per `CONST-001` Article IX (higher-authority documents are not silently overridden).
- **Affected Database Objects:** None yet. Possible future impact analyzed in `REQ-001-PLAN`'s "Database Impact Analysis" — no table, column, or migration has been created or decided.
- **Affected APIs:** None yet. Placeholder endpoints listed in `REQ-001-PLAN`'s "API Requirement Placeholders" — none built or committed to.
- **Affected Implementation:** None. No code was written for this ECIA.
- **Affected Tests:** None yet. Testing strategy and the specific regression risk (every existing route test currently constructs unauthenticated requests) are documented in `REQ-001-PLAN`'s "Testing Strategy".
- **Affected Documentation:** `docs/requirements/REQ-001-authentication.md` (cross-references added), `docs/requirements/RTM.md` (`REQ-001` row updated), `docs/requirements/REQ-INDEX.md`, `docs/governance/ECIA-INDEX.md`, `docs/governance/RISK-INDEX.md`, `docs/governance/RISK-001-unauthenticated-endpoints.md` (new).
- **Affected Security:** Directly. This planning pass surfaced and formally registered a real, current gap — every backend endpoint is reachable without authentication today — as `RISK-001`. See that record for detection/mitigation.
- **Affected Operations:** None yet. Once a provider is chosen, deployment will need new secrets (`REQ-001-PLAN`'s "Migration Considerations") — not yet actionable.

## Migration Requirements

None yet — no schema or API exists to migrate. `REQ-001-PLAN`'s "Migration Considerations" section documents the rollout concern (avoid a flag-flip cutover that locks out the current user) for when implementation begins.

## Rollback Strategy

N/A — nothing was deployed or implemented in this pass. A rollback strategy is implementation-phase scope, once a provider and approach are chosen.

## Future Epic Impact

Phase 4 (Core Platform) implementation work on `REQ-001` should start from `REQ-001-PLAN.md` rather than re-deriving this analysis. The open questions it lists (token model, device-revocation storage, 401-vs-403 on cross-workspace access) have since been resolved by `ADR-0022` (Authentication Architecture, Sprint 4.3) — implementation should follow that decision rather than re-opening these questions.

## Constitution/Handbook Impact

None. This planning pass did not propose, and does not require, any change to `CONST-001` or `HB-001`.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.1 | 2026-08-01 | Noted in "Future Epic Impact" that `ADR-0022` (Sprint 4.3) has since resolved the open questions this ECIA's planning pass left open. No change to the original Impact Analysis — it remains an accurate record of Sprint 4.2's scope. |
| 1.0 | 2026-08-01 | Initial ECIA, covering the authentication planning pass (EPIC-004 Sprint 4.2). No code, schema, or API changes — planning only. |
