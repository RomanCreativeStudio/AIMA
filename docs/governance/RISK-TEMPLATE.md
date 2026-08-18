# AIMA Risk Register Entry Template

**Document ID:** RISK-TEMPLATE
**Document Name:** AIMA Risk Register Entry Template
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; governs how `RISK-*` entries are authored, subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Engineering Council (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `ECIA-INDEX`
**Dependents:** Every risk entry from `RISK-001` onward
**Review Frequency:** Whenever the risk register practice itself changes
**Last Updated:** 2026-08-01
**Related Documents:** [`RISK-INDEX.md`](RISK-INDEX.md), [`ECIA-INDEX.md`](ECIA-INDEX.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md)

---

## Purpose

This is the template for every Risk Register entry in AIMA. It formalizes the fields a risk must be tracked with — what it is, how severe and likely it is, how it would be detected, and how it's mitigated or contained — so risks are managed deliberately rather than discovered as incidents.

**Scope note:** `HB-001`'s original "Risk Register" section was a one-line placeholder note ("Future `RISK-*` items should record description, affected areas, likelihood, impact, mitigation, owner, status, and review date") — no risk register or risk entry has ever existed in AIMA. This template formalizes and extends that original field set (likelihood → Probability, affected areas → Related Architecture/Requirements, review date → Review History) with Detection Method, Contingency Plan, and Related ADRs/ECIA. It does not itself assert that any risk exists.

## How to Use This Template

1. Copy this file to `docs/governance/RISK-00NN-short-slug.md`, where `NN` is the next unused number after the highest entry in [`RISK-INDEX.md`](RISK-INDEX.md).
2. Fill in every field and section below. Use **Placeholder** with a one-line reason, not silence, for a value that genuinely isn't known yet.
3. Add a row for the new risk to [`RISK-INDEX.md`](RISK-INDEX.md) — that file is the single canonical index; do not maintain a second copy of the list elsewhere.
4. Get the entry reviewed by the Engineering Council (per `HB-001`'s Documentation Ownership table) before marking it `Confirmed`.
5. Never delete a past risk entry to hide that it was resolved or reassessed — update its Status (`Mitigated` / `Accepted` / `Closed` / `Superseded by RISK-00NN`) and add a row to its Review History instead (`CONST-001` Article X: the history of why decisions were made should never be lost).

---

## Template

```markdown
# RISK 00NN: <Risk Title>

**Document ID:** RISK-00NN
**Status:** Identified | Confirmed | Mitigating | Accepted | Closed | Superseded by RISK-00NN
**Severity:** Critical | High | Medium | Low
**Probability:** Critical | High | Medium | Low
**Owner:** <Responsible engineer or Engineering Council member>

## Description

What is the risk, concretely? What could go wrong, and under what conditions?

## Impact

What is the consequence if this risk materializes? Who or what is affected?

## Detection Method

How would the team notice this risk has materialized — monitoring, alerting, manual review, user report?

## Mitigation Strategy

What reduces the likelihood or severity of this risk? What is being done now, or planned?

## Contingency Plan

If the risk materializes despite mitigation, what is the response?

## Related ADRs

<ADR-* IDs, or "None registered yet">

## Related Requirements

<REQ-* IDs, or "None registered yet">

## Related Architecture

<ARCH-001 section(s), or specific subsystem>

## Related ECIA

<ECIA-* IDs, or "None registered yet">

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.0 | YYYY-MM-DD | <Reviewer> | Initial identification. |
```
