# AIMA Requirements Traceability Matrix

**Document ID:** RTM-001
**Document Name:** AIMA Requirements Traceability Matrix
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational traceability register; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Product owner + Lead Software Architect (joint — the matrix spans both the requirements and architecture domains, per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `REQ-INDEX`, `ADR-INDEX`
**Dependents:** `REQ-INDEX` (each new requirement should gain a row here), `ADR-INDEX`, `ECIA-INDEX` (change impact analyses reference this matrix)
**Review Frequency:** Every new or changed requirement, ADR, or architecture section
**Last Updated:** 2026-08-01
**Related Documents:** [`REQ-INDEX.md`](REQ-INDEX.md), [`REQ-TEMPLATE.md`](REQ-TEMPLATE.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../governance/ECIA-INDEX.md`](../governance/ECIA-INDEX.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md)

---

## Purpose

This is the single, canonical Requirements Traceability Matrix (RTM) for AIMA. It maps every requirement through the chain it must be traceable across — Requirement → Architecture → ADR → Database → API → Implementation → Tests → Documentation — so a requirement's real-world footprint can be found in one place. This file is authoritative for the matrix; it consolidates the matrix that previously lived inline in `HB-001` (moved here, not duplicated, per `HB-001`'s own Documentation Review Workflow: "preserve existing useful content; move it rather than delete it").

The matrix supports traceability specifically between **Requirements**, **ADRs**, **Architecture**, **Implementation**, and **Tests** (the relationships this framework was established to cover), plus the pre-existing **Database**, **API**, and **Documentation** columns carried over unchanged from `HB-001`'s original matrix.

**Scope note:** the `REQ-000 Placeholder` row below is illustrative scaffolding carried over from `HB-001`. It demonstrates the required chain and column shape — it is not a real, decided requirement, and its ID was renumbered from `REQ-001` to `REQ-000` once a real `REQ-001` (Authentication) was authored, to remove the collision (see [`REQ-INDEX.md`](REQ-INDEX.md)). `REQ-000` is not, and will never be, a real requirement ID. The rows for `REQ-001`–`REQ-005` below are real, authored requirements.

## How to Add a New Traceability Row

1. Author the requirement using [`REQ-TEMPLATE.md`](REQ-TEMPLATE.md) and register it in [`REQ-INDEX.md`](REQ-INDEX.md).
2. Add a row to the table below linking the requirement's ID to its architecture section(s), related ADR(s) (from [`ADR-INDEX.md`](../decisions/ADR-INDEX.md)), database/API references if applicable, implementation paths, test paths, and documentation.
3. Use **Placeholder** or **Not yet implemented** for any column that isn't real yet — do not invent an architecture section, ADR, implementation path, or test that doesn't exist.
4. Keep rows in `REQ-*` numeric order.

## Matrix

| Requirement | Architecture | ADR | Database | API | Implementation | Tests | Documentation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `REQ-000` Placeholder | `ARCH-001` Placeholder | `ADR-0001+` Placeholder | `DB-001` Placeholder | `API-001` Placeholder | Placeholder | Placeholder | Placeholder |
| `REQ-001` Authentication | `ARCH-001` §"Authentication", §9 | None registered yet | Not yet implemented (see `REQ-001-PLAN`'s Database Impact Analysis) | Not yet implemented (placeholders in `REQ-001-PLAN`) | Not yet implemented | Not yet implemented (strategy in `REQ-001-PLAN`) | [`REQ-001-authentication.md`](REQ-001-authentication.md), [`REQ-001-implementation-plan.md`](REQ-001-implementation-plan.md), [`ECIA-001`](../governance/ECIA-001-authentication-foundation.md), [`RISK-001`](../governance/RISK-001-unauthenticated-endpoints.md) |
| `REQ-002` User Management | `ARCH-001` §"User Profile System (Phase 1.8)" | `ADR-0008` | `database/migrations/0008_user_profile_and_workspace_config.sql` | `GET/PATCH /api/users/:userId` | `backend/src/users/userService.ts` | `backend/src/users/userService.test.ts` | [`REQ-002-user-management.md`](REQ-002-user-management.md) |
| `REQ-003` Workspace Management | `ARCH-001` §"Workspace Configuration System (Phase 1.8)", §6 | `ADR-0008` | `database/migrations/0008_user_profile_and_workspace_config.sql` | `POST/GET/PATCH /api/workspaces[/:id]`, `GET /api/users/:id/workspaces` | `backend/src/workspaces/workspaceService.ts` | `backend/src/workspaces/workspaceService.test.ts` | [`REQ-003-workspace-management.md`](REQ-003-workspace-management.md) |
| `REQ-004` Permission Engine | `ARCH-001` §5, §6 | `ADR-0004`, `ADR-0007`, `ADR-0014` | `database/migrations/0001_init.sql` (capabilities), `0006_approval_lifecycle.sql` (pending_approvals) | Approvals routes (`backend/src/routes/approvals.ts`) | `backend/src/permissions/engine.ts`, `backend/src/approval/`, `backend/src/execution/` | `backend/src/permissions/engine.test.ts` | [`REQ-004-permission-engine.md`](REQ-004-permission-engine.md) |
| `REQ-005` Configuration Management | `ARCH-001` §"Production Deployment Foundation (Phase 3.1)" | `ADR-0016` | N/A | N/A | `backend/src/config/env.ts` | `backend/src/config/env.test.ts`, `backend/src/config/deploymentReadiness.test.ts` | [`REQ-005-configuration-management.md`](REQ-005-configuration-management.md) |

## Column Definitions

- **Requirement** — a `REQ-*` ID from [`REQ-INDEX.md`](REQ-INDEX.md).
- **Architecture** — the `ARCH-001` section(s) (or future `docs/architecture/` document) this requirement affects.
- **ADR** — the `ADR-*` ID(s) from [`ADR-INDEX.md`](../decisions/ADR-INDEX.md) that implement or inform this requirement.
- **Database** — `DB-*` references, once a dedicated database documentation area exists.
- **API** — `API-*` references, once `docs/api/` exists.
- **Implementation** — source paths that implement the requirement.
- **Tests** — test file paths or suite names that verify the requirement.
- **Documentation** — other documents or sections affected by the requirement.
