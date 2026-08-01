# AIMA Engineering Change Impact Analysis Index

**Document ID:** ECIA-INDEX
**Document Name:** AIMA Engineering Change Impact Analysis Index
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational index; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Authoring engineer + reviewer (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `RTM-001`
**Dependents:** Contributors, future ECIA records
**Review Frequency:** Every new or changed ECIA record
**Last Updated:** 2026-08-01
**Related Documents:** [`ECIA-TEMPLATE.md`](ECIA-TEMPLATE.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../requirements/RTM.md`](../requirements/RTM.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md)

---

## Purpose

This is the single, canonical index of every Engineering Change Impact Analysis (ECIA) record in AIMA. It exists so a material change's impact assessment — across requirements, ADRs, architecture, database, APIs, implementation, tests, documentation, security, and operations — can be found in one place. This file is authoritative for the ECIA list.

## Adding a New ECIA Record

1. Start from [`ECIA-TEMPLATE.md`](ECIA-TEMPLATE.md).
2. Use the next sequential number after the highest one below.
3. Add a row to the table, in numeric order.
4. Never reuse or renumber a stable ECIA ID after publication (`HB-001`'s Permanent Numbering Standard).

## Index

| ECIA ID | Change Name | Status | Date | File |
| --- | --- | --- | --- | --- |
| _(none yet)_ | | | | |

No ECIA records have been formally authored in AIMA yet. This table will be populated as `ECIA-00NN` entries are created from [`ECIA-TEMPLATE.md`](ECIA-TEMPLATE.md), for material engineering changes going forward.

**Next available ID:** `ECIA-001`.

## Status Legend

- **Draft** — being written, impacts not yet fully assessed.
- **Reviewed** — impact analysis reviewed, not yet approved for the change to proceed.
- **Approved** — reviewed and accepted; the change may proceed with this impact analysis as its record.
- **Superseded by ECIA-00NN** — replaced by a later, corrected analysis; the original text is preserved, not deleted (`CONST-001` Article X).
