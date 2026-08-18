# AIMA Engineering Change Impact Analysis Template

**Document ID:** ECIA-TEMPLATE
**Document Name:** AIMA Engineering Change Impact Analysis Template
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; governs how `ECIA-*` records are authored, subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Authoring engineer + reviewer (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `RTM-001`
**Dependents:** Every ECIA record from `ECIA-001` onward
**Review Frequency:** Whenever the ECIA practice itself changes
**Last Updated:** 2026-08-01
**Related Documents:** [`ECIA-INDEX.md`](ECIA-INDEX.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../requirements/RTM.md`](../requirements/RTM.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md)

---

## Purpose

This is the template for every material engineering change's Impact Analysis (ECIA) in AIMA. It formalizes the categories a change must be assessed against before it ships, so second-order effects are considered deliberately rather than discovered after the fact.

**Scope note:** `HB-001`'s original "Engineering Change Impact Analysis (ECIA)" section already declared eight categories to identify (Requirements, APIs, Database Objects, Documentation, Tests, Migration Requirements, Rollback Strategy, Future Epic Impact) and an inline template. That content is preserved here, extended with the Architecture, ADRs, Implementation, Security, and Operations categories this framework adds, and moved to a stable file rather than duplicated (`HB-001`'s Documentation Review Workflow: preserve existing useful content, move it rather than delete it). No ECIA record has been formally authored in AIMA yet — this template establishes how future ones must be captured; it does not itself assert any change happened.

## How to Use This Template

1. Copy this file to `docs/governance/ECIA-00NN-short-slug.md`, where `NN` is the next unused number after the highest entry in [`ECIA-INDEX.md`](ECIA-INDEX.md).
2. Fill in every field and section below. Use **N/A** with a one-line reason, not silence, for a category that genuinely doesn't apply to this change.
3. Add a row for the new record to [`ECIA-INDEX.md`](ECIA-INDEX.md) — that file is the single canonical index; do not maintain a second copy of the list elsewhere.
4. Include the ECIA's summary in the PR body for the change it covers (`HB-001`'s Documentation Review Workflow step 6).
5. Never delete or silently rewrite a past ECIA record — add a new one and mark the old one's Status as `Superseded by ECIA-00NN` if a later change revises its analysis (`CONST-001` Article X: the history of why decisions were made should never be lost).

---

## Template

```markdown
# ECIA 00NN: <Change Name>

**Document ID:** ECIA-00NN
**Status:** Draft | Reviewed | Approved | Superseded by ECIA-00NN
**Date:** YYYY-MM-DD
**Owner:** <Authoring engineer>
**Reviewer:** <Reviewing engineer, once reviewed>

## Change Summary

What is changing, and why?

## Impact Analysis

- **Affected Requirements:** <REQ-* IDs, or "None">
- **Affected ADRs:** <ADR-* IDs, or "None">
- **Affected Architecture:** <ARCH-001 section(s), or "None">
- **Affected Database Objects:** <tables/migrations, or "None">
- **Affected APIs:** <endpoints, or "None">
- **Affected Implementation:** <source paths, or "None">
- **Affected Tests:** <test paths, or "None">
- **Affected Documentation:** <docs, or "None">
- **Affected Security:** <auth, permissions, data exposure, or "None">
- **Affected Operations:** <deployment, monitoring, on-call, or "None">

## Migration Requirements

## Rollback Strategy

## Future Epic Impact

## Constitution/Handbook Impact

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | YYYY-MM-DD | Initial ECIA. |
```
