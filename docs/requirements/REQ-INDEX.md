# AIMA Requirements Index

**Document ID:** REQ-INDEX
**Document Name:** AIMA Requirements Index
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational index; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Product owner (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`
**Dependents:** Contributors, future requirements, `RTM-001`
**Review Frequency:** Every new or changed requirement
**Last Updated:** 2026-08-01
**Related Documents:** [`REQ-TEMPLATE.md`](REQ-TEMPLATE.md), [`RTM.md`](RTM.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md)

---

## Purpose

This is the single, canonical index of every Requirement in AIMA. It exists so a requirement's status, priority, and file location can be found in one place. This file is authoritative for the requirements list; [`RTM.md`](RTM.md) (`RTM-001`) is about the traceability chain a requirement must map through, not a second registry — see "Relationship to `RTM-001`" below.

## Adding a New Requirement

1. Start from [`REQ-TEMPLATE.md`](REQ-TEMPLATE.md).
2. Use the next sequential number after the highest one below.
3. Add a row to the table, in numeric order.
4. Never reuse or renumber a stable Requirement ID after publication (`HB-001`'s Permanent Numbering Standard).

## Index

| Requirement ID | Title | Status | Priority | Category | File |
| --- | --- | --- | --- | --- | --- |
| REQ-001 | Authentication | Implemented | High | Security | [`REQ-001-authentication.md`](REQ-001-authentication.md) |
| REQ-002 | User Management | Approved | High | Functional | [`REQ-002-user-management.md`](REQ-002-user-management.md) |
| REQ-003 | Workspace Management | Approved | High | Functional | [`REQ-003-workspace-management.md`](REQ-003-workspace-management.md) |
| REQ-004 | Permission Engine | Approved | Critical | Security | [`REQ-004-permission-engine.md`](REQ-004-permission-engine.md) |
| REQ-005 | Configuration Management | Approved | High | Non-Functional | [`REQ-005-configuration-management.md`](REQ-005-configuration-management.md) |

REQ-002 through REQ-005 document existing, implemented Core Platform systems. REQ-001 documented `ARCH-001`'s existing authentication design at a time it was not yet built; as of EPIC-004 Sprint 4.7 (`ADR-0022`, `ADR-0023`) all five of its acceptance criteria are met and its status reflects that — see the requirement's own repository audit finding for the implementation history, and `RTM.md`'s `REQ-001` row for the live source/test trace.

**Next available ID:** `REQ-006`.

## Status Legend

- **Proposed** — drafted, not yet reviewed/approved.
- **Approved** — reviewed and accepted; implementation not necessarily complete.
- **Implemented** — built and traceable to source/tests.
- **Deprecated** — no longer required, withdrawn without a replacement.
- **Superseded by REQ-00NN** — replaced by a specific later requirement; the original text is preserved, not deleted (`CONST-001` Article X).

## Relationship to `RTM-001`

[`RTM.md`](RTM.md) (`RTM-001`) is the canonical Requirements Traceability Matrix. It now carries real rows for `REQ-001` through `REQ-005`, alongside the original illustrative `REQ-001 Placeholder` row — which predates this index, is not a registered requirement, and is left in place as historical scaffolding (`HB-001`'s Documentation Review Workflow: preserve existing content rather than delete it). Do not confuse the placeholder row with the real `REQ-001` below it.
