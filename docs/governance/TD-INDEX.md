# AIMA Technical Debt Register Index

**Document ID:** TD-INDEX
**Document Name:** AIMA Technical Debt Register Index
**Version:** 1.2.0
**Status:** Active
**Authority Level:** Operational index; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Engineering Council (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `ECIA-INDEX`, `RISK-INDEX`
**Dependents:** Contributors, future technical debt entries
**Review Frequency:** Every new or changed technical debt entry
**Last Updated:** 2026-08-02
**Related Documents:** [`TD-TEMPLATE.md`](TD-TEMPLATE.md), [`RISK-INDEX.md`](RISK-INDEX.md), [`ECIA-INDEX.md`](ECIA-INDEX.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md)

---

## Purpose

This is the single, canonical index of every Technical Debt Register entry in AIMA. It exists so a debt item's status, priority, category, and file location can be found in one place. This file is authoritative for the technical debt list.

## Adding a New Technical Debt Entry

1. Start from [`TD-TEMPLATE.md`](TD-TEMPLATE.md).
2. Use the next sequential number after the highest one below.
3. Add a row to the table, in numeric order.
4. Never reuse or renumber a stable Technical Debt ID after publication (`HB-001`'s Permanent Numbering Standard).

## Index

| Debt ID | Title | Status | Priority | Category | Owner | File |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | Production Deploys From a Long-Lived Feature Branch, Not `main` | Identified | Medium | Infrastructure | Lead Software Architect | [`TD-001-production-deploys-from-feature-branch.md`](TD-001-production-deploys-from-feature-branch.md) |
| TD-002 | Production OAuth Credentials Are Placeholder Values — No Real Google or GitHub App Registered | Identified | High | Infrastructure | Product owner | [`TD-002-google-github-oauth-apps-not-registered.md`](TD-002-google-github-oauth-apps-not-registered.md) |

**Next available ID:** `TD-003`.

## Status Legend

- **Identified** — recorded, not yet reviewed by the Engineering Council.
- **Accepted** — reviewed and consciously carried, with reasoning recorded in the entry.
- **In Progress** — active resolution work underway.
- **Resolved** — fully addressed; no longer carried.
- **Superseded by TD-00NN** — replaced by a later, more precise entry; the original text is preserved, not deleted (`CONST-001` Article X).

## Priority Scale

`Critical | High | Medium | Low`, consistent with the Risk Register's severity/probability scale so entries can be compared across registers.
