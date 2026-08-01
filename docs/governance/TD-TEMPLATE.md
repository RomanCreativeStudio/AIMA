# AIMA Technical Debt Register Entry Template

**Document ID:** TD-TEMPLATE
**Document Name:** AIMA Technical Debt Register Entry Template
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; governs how `TD-*` entries are authored, subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Engineering Council (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `ECIA-INDEX`, `RISK-INDEX`
**Dependents:** Every technical debt entry from `TD-001` onward
**Review Frequency:** Whenever the technical debt register practice itself changes
**Last Updated:** 2026-08-01
**Related Documents:** [`TD-INDEX.md`](TD-INDEX.md), [`RISK-INDEX.md`](RISK-INDEX.md), [`ECIA-INDEX.md`](ECIA-INDEX.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md)

---

## Purpose

This is the template for every Technical Debt Register entry in AIMA. It formalizes the fields a debt item must be tracked with — what was traded off, why, what it costs to carry, and what resolving it would take — so debt is managed as a deliberate, visible ledger rather than tribal knowledge.

**Scope note:** `HB-001`'s original "Technical Debt Register" section was a one-line placeholder note ("Future `TD-*` items should record debt description, reason accepted, affected areas, cost of delay, remediation plan, owner, and target review") — no technical debt register or entry has ever existed in AIMA. This template formalizes and extends that original field set (reason accepted → Reason Introduced, affected areas → Affected Systems/Related Architecture, cost of delay → Impact/Risk Level, remediation plan → Recommended Resolution/Estimated Effort, target review → Review History) with Related ADRs/Requirements/ECIA/Risks. It does not itself assert that any technical debt exists.

## How to Use This Template

1. Copy this file to `docs/governance/TD-00NN-short-slug.md`, where `NN` is the next unused number after the highest entry in [`TD-INDEX.md`](TD-INDEX.md).
2. Fill in every field and section below. Use **Placeholder** with a one-line reason, not silence, for a value that genuinely isn't known yet.
3. Add a row for the new entry to [`TD-INDEX.md`](TD-INDEX.md) — that file is the single canonical index; do not maintain a second copy of the list elsewhere.
4. Get the entry reviewed by the Engineering Council (per `HB-001`'s Documentation Ownership table) before marking it `Accepted`.
5. Never delete a past technical debt entry to hide that it was resolved or reassessed — update its Status (`Resolved` / `Accepted` / `Superseded by TD-00NN`) and add a row to its Review History instead (`CONST-001` Article X: the history of why decisions were made should never be lost).

---

## Template

```markdown
# TD 00NN: <Debt Title>

**Document ID:** TD-00NN
**Status:** Identified | Accepted | In Progress | Resolved | Superseded by TD-00NN
**Priority:** Critical | High | Medium | Low
**Category:** <Architecture | Code Quality | Testing | Documentation | Infrastructure | Security | ...>
**Owner:** <Responsible engineer or Engineering Council member>

## Description

What is the debt, concretely — what shortcut, deferred work, or suboptimal implementation was taken?

## Reason Introduced

Why was this trade-off made? What constraint (time, scope, unknowns) drove it?

## Affected Systems

Which modules, services, or components carry this debt?

## Impact

What does carrying this debt cost — in velocity, reliability, security, or maintainability?

## Risk Level

Critical | High | Medium | Low — how much worse does this get if left unresolved?

## Recommended Resolution

What would resolving this debt involve?

## Estimated Effort

<Rough sizing, or "Unknown" with a one-line reason>

## Related ADRs

<ADR-* IDs, or "None registered yet">

## Related Requirements

<REQ-* IDs, or "None registered yet">

## Related Architecture

<ARCH-001 section(s), or specific subsystem>

## Related ECIA

<ECIA-* IDs, or "None registered yet">

## Related Risks

<RISK-* IDs, or "None registered yet">

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.0 | YYYY-MM-DD | <Reviewer> | Initial identification. |
```
