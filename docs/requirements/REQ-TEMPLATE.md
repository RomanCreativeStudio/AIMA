# AIMA Requirement Template

**Document ID:** REQ-TEMPLATE
**Document Name:** AIMA Requirement Template
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; governs how `REQ-*` documents are authored, subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Product owner (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`
**Dependents:** Every requirement from `REQ-001` onward
**Review Frequency:** Whenever the requirements practice itself changes
**Last Updated:** 2026-08-01
**Related Documents:** [`REQ-INDEX.md`](REQ-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md)

---

## Purpose

This is the template for every new Requirement in AIMA. It formalizes the fields a requirement must cover so its scope, acceptance criteria, and traceability to architecture, decisions, tests, and implementation are captured explicitly, not left implicit.

**Scope note:** `HB-001`'s Requirements Traceability Matrix currently contains a single illustrative row, `REQ-001 Placeholder`, demonstrating the required `Requirement → Architecture → ADR → Database → API → Implementation → Tests → Documentation` chain. That row is example scaffolding, not a real, decided requirement — no requirements have been formally authored in AIMA yet. This template establishes how future requirements must be captured; it does not itself assert any.

## How to Use This Template

1. Copy this file to `docs/requirements/REQ-0NN-short-slug.md`, where `NN` is the next unused number after the highest entry in [`REQ-INDEX.md`](REQ-INDEX.md).
2. Fill in every field and section below. Use **Placeholder** with a one-line reason, not silence, for a value that genuinely isn't known yet (per `HB-001`'s Universal Chapter Template convention).
3. Add a row for the new requirement to [`REQ-INDEX.md`](REQ-INDEX.md) — that file is the single canonical index; do not maintain a second copy of the list elsewhere.
4. Get the requirement reviewed by the Product owner (per `HB-001`'s Documentation Ownership table) before marking it `Approved`.
5. Never delete or silently rewrite a past requirement to hide that it changed — add a new requirement and mark the old one's Status as `Superseded by REQ-0NN`, or `Deprecated` if withdrawn without replacement (`CONST-001` Article X: the history of why decisions were made should never be lost).

---

## Template

```markdown
# REQ 00NN: <Requirement Title>

**Document ID:** REQ-00NN
**Status:** Proposed | Approved | Implemented | Deprecated | Superseded by REQ-00NN
**Priority:** Critical | High | Medium | Low
**Category:** <Functional | Non-Functional | Security | Performance | Compliance | ...>
**Owner:** <Product owner>

## Description

What capability or constraint must the system satisfy? State it plainly, in product/business terms.

## Acceptance Criteria

What observable, testable conditions establish that this requirement is met?

## Dependencies

What other requirements, systems, or decisions must exist first?

## Related ADRs

<ADR-* IDs, or "None registered yet">

## Related Architecture

<ARCH-001 section(s), or specific subsystem>

## Related Tests

<Test file paths or suite names, or "Not yet implemented">

## Related Implementation

<Source paths, or "Not yet implemented">

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | YYYY-MM-DD | Initial requirement. |
```
