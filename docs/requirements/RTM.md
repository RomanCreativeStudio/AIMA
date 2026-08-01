# AIMA Requirements Traceability Matrix

**Document ID:** RTM-001
**Document Name:** AIMA Requirements Traceability Matrix
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational traceability register; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Product owner + Lead Software Architect (joint — the matrix spans both the requirements and architecture domains, per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `REQ-INDEX`, `ADR-INDEX`
**Dependents:** `REQ-INDEX` (each new requirement should gain a row here), `ADR-INDEX`, contributors performing Engineering Change Impact Analysis (ECIA)
**Review Frequency:** Every new or changed requirement, ADR, or architecture section
**Last Updated:** 2026-08-01
**Related Documents:** [`REQ-INDEX.md`](REQ-INDEX.md), [`REQ-TEMPLATE.md`](REQ-TEMPLATE.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md)

---

## Purpose

This is the single, canonical Requirements Traceability Matrix (RTM) for AIMA. It maps every requirement through the chain it must be traceable across — Requirement → Architecture → ADR → Database → API → Implementation → Tests → Documentation — so a requirement's real-world footprint can be found in one place. This file is authoritative for the matrix; it consolidates the matrix that previously lived inline in `HB-001` (moved here, not duplicated, per `HB-001`'s own Documentation Review Workflow: "preserve existing useful content; move it rather than delete it").

The matrix supports traceability specifically between **Requirements**, **ADRs**, **Architecture**, **Implementation**, and **Tests** (the relationships this framework was established to cover), plus the pre-existing **Database**, **API**, and **Documentation** columns carried over unchanged from `HB-001`'s original matrix.

**Scope note:** the single row below, `REQ-001 Placeholder`, is illustrative scaffolding carried over from `HB-001`. It demonstrates the required chain and column shape — it is not a real, decided requirement. No requirements have been formally authored in AIMA yet (see [`REQ-INDEX.md`](REQ-INDEX.md)), so no real traceability rows exist yet either. Nothing here should be read as inventing a requirement, ADR, implementation, or test that doesn't exist.

## How to Add a New Traceability Row

1. Author the requirement using [`REQ-TEMPLATE.md`](REQ-TEMPLATE.md) and register it in [`REQ-INDEX.md`](REQ-INDEX.md).
2. Add a row to the table below linking the requirement's ID to its architecture section(s), related ADR(s) (from [`ADR-INDEX.md`](../decisions/ADR-INDEX.md)), database/API references if applicable, implementation paths, test paths, and documentation.
3. Use **Placeholder** or **Not yet implemented** for any column that isn't real yet — do not invent an architecture section, ADR, implementation path, or test that doesn't exist.
4. Keep rows in `REQ-*` numeric order.

## Matrix

| Requirement | Architecture | ADR | Database | API | Implementation | Tests | Documentation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `REQ-001` Placeholder | `ARCH-001` Placeholder | `ADR-0001+` Placeholder | `DB-001` Placeholder | `API-001` Placeholder | Placeholder | Placeholder | Placeholder |

## Column Definitions

- **Requirement** — a `REQ-*` ID from [`REQ-INDEX.md`](REQ-INDEX.md).
- **Architecture** — the `ARCH-001` section(s) (or future `docs/architecture/` document) this requirement affects.
- **ADR** — the `ADR-*` ID(s) from [`ADR-INDEX.md`](../decisions/ADR-INDEX.md) that implement or inform this requirement.
- **Database** — `DB-*` references, once a dedicated database documentation area exists.
- **API** — `API-*` references, once `docs/api/` exists.
- **Implementation** — source paths that implement the requirement.
- **Tests** — test file paths or suite names that verify the requirement.
- **Documentation** — other documents or sections affected by the requirement.
