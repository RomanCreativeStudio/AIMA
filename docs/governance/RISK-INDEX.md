# AIMA Risk Register Index

**Document ID:** RISK-INDEX
**Document Name:** AIMA Risk Register Index
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational index; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Engineering Council (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `ECIA-INDEX`
**Dependents:** Contributors, future risk entries
**Review Frequency:** Every new or changed risk entry
**Last Updated:** 2026-08-01
**Related Documents:** [`RISK-TEMPLATE.md`](RISK-TEMPLATE.md), [`ECIA-INDEX.md`](ECIA-INDEX.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md)

---

## Purpose

This is the single, canonical index of every risk entry in AIMA's Risk Register. It exists so a risk's status, severity, probability, and file location can be found in one place. This file is authoritative for the risk list.

## Adding a New Risk

1. Start from [`RISK-TEMPLATE.md`](RISK-TEMPLATE.md).
2. Use the next sequential number after the highest one below.
3. Add a row to the table, in numeric order.
4. Never reuse or renumber a stable Risk ID after publication (`HB-001`'s Permanent Numbering Standard).

## Index

| Risk ID | Title | Status | Severity | Probability | Owner | File |
| --- | --- | --- | --- | --- | --- | --- |
| RISK-001 | Every Backend Endpoint Is Reachable Without Authentication | Mitigating | Critical | High | Lead Software Architect | [`RISK-001-unauthenticated-endpoints.md`](RISK-001-unauthenticated-endpoints.md) |

**Next available ID:** `RISK-002`.

## Status Legend

- **Identified** — recorded, not yet reviewed by the Engineering Council.
- **Confirmed** — reviewed and accepted as a real, tracked risk.
- **Mitigating** — active mitigation work in progress.
- **Accepted** — the risk is acknowledged and consciously not mitigated further (with reasoning recorded in the entry).
- **Closed** — no longer applicable or fully resolved.
- **Superseded by RISK-00NN** — replaced by a later, more precise entry; the original text is preserved, not deleted (`CONST-001` Article X).

## Severity / Probability Scale

`Critical | High | Medium | Low`, consistently applied across both dimensions so entries can be compared at a glance.
