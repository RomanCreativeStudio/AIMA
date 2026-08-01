# AIMA Documentation Index

**Document ID:** DOC-INDEX-001
**Document Name:** AIMA Master Documentation Index
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational index; subordinate to `CONST-001` and `HB-001`
**Owner:** Lead Product Architect / Lead Software Architect
**Dependencies:** `CONST-001`, `HB-001`
**Dependents:** Contributors, sprint plans, PR reviews
**Review Frequency:** Every sprint close
**Last Updated:** 2026-08-01
**Related Documents:** [`docs/PRODUCT_BIBLE.md`](PRODUCT_BIBLE.md), [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md)

## Start Here

1. [`CONSTITUTION.md`](CONSTITUTION.md) — `CONST-001`, the highest-authority governance document.
2. [`PRODUCT_BIBLE.md`](PRODUCT_BIBLE.md) — `HB-001`, AIMA Engineering Handbook v2.0 and preserved Product Bible content.
3. [`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) — `ARCH-001`, engineering blueprint.
4. [`DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md) — `DEV-001`, local development and workflow guide.
5. [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) — `DEPLOY-001`, production deployment and operations guide.
6. [`decisions/`](decisions/) — Architecture Decision Records (`ADR-*`). Start at [`decisions/ADR-INDEX.md`](decisions/ADR-INDEX.md) (canonical index) and [`decisions/ADR-TEMPLATE.md`](decisions/ADR-TEMPLATE.md) (template for new ADRs).
7. [`requirements/`](requirements/) — Requirements (`REQ-*`). Start at [`requirements/REQ-INDEX.md`](requirements/REQ-INDEX.md) (canonical index) and [`requirements/REQ-TEMPLATE.md`](requirements/REQ-TEMPLATE.md) (template for new requirements); no requirements are registered yet. Traceability across requirements/architecture/ADRs/database/API/implementation/tests/documentation is tracked in [`requirements/RTM.md`](requirements/RTM.md) (`RTM-001`).
8. [`governance/`](governance/) — cross-cutting governance records. Start at [`governance/ECIA-INDEX.md`](governance/ECIA-INDEX.md) (canonical index) and [`governance/ECIA-TEMPLATE.md`](governance/ECIA-TEMPLATE.md) (template for new Engineering Change Impact Analyses, `ECIA-*`); no ECIA records are registered yet.

## Documentation Map

| Area | Current Location | Stable IDs |
| --- | --- | --- |
| Constitution | [`CONSTITUTION.md`](CONSTITUTION.md) | `CONST-*` |
| Engineering Handbook | [`PRODUCT_BIBLE.md`](PRODUCT_BIBLE.md) | `HB-*` |
| Architecture | [`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) | `ARCH-*` |
| ADRs | [`decisions/`](decisions/) | `ADR-*` |
| Development Setup | [`DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md) | `DEV-*` |
| Production Setup | [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) | `DEPLOY-*` |
| Requirements | [`requirements/`](requirements/) | `REQ-*` |
| Requirements Traceability Matrix | [`requirements/RTM.md`](requirements/RTM.md) | `RTM-*` |
| Engineering Change Impact Analysis | [`governance/`](governance/) | `ECIA-*` |
| APIs | Future `api/` | `API-*` |
| Database | [`../database/README.md`](../database/README.md), future `database/` | `DB-*` |
| Risk Register | Future `governance/risk-register.md` | `RISK-*` |
| Technical Debt Register | Future `governance/technical-debt-register.md` | `TD-*` |
| Sprints | Future `sprints/` | `SPR-*` |

## Contributor Rule

When adding or changing documentation, preserve useful historical content, add stable IDs for new major artifacts, and update this index when a new documentation area is created.
