# AIMA ADR Template

**Document ID:** ADR-TEMPLATE
**Document Name:** AIMA Architecture Decision Record Template
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; governs how `ADR-*` documents are authored, subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Authoring engineer + reviewer (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`
**Dependents:** Every ADR from `ADR-0022` onward
**Review Frequency:** Whenever the ADR practice itself changes
**Last Updated:** 2026-08-01
**Related Documents:** [`ADR-INDEX.md`](ADR-INDEX.md), [`../CONSTITUTION.md`](../CONSTITUTION.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md)

---

## Purpose

This is the template for every new Architecture Decision Record (ADR) in AIMA. It formalizes the fields an ADR must cover, going forward, so a decision's context, alternatives, trade-offs, and consequences are captured while they're still fresh — not reconstructed later from memory or git blame.

**Scope note:** ADR-0001 through ADR-0021 (`docs/decisions/000*.md`) predate this template and use a lighter format (Status/Date/Relates to, Context, Decision(s), Consequences). They are preserved exactly as written — this template is not applied retroactively. Retrofitting the missing sections onto historical ADRs would mean inventing "alternatives considered" and "risks" for decisions already made, which is exactly the kind of invented governance this framework exists to avoid. Apply this template starting at `ADR-0022`.

## How to Use This Template

1. Copy this file to `docs/decisions/00NN-short-slug.md`, where `NN` is the next unused number after the highest entry in [`ADR-INDEX.md`](ADR-INDEX.md).
2. Fill in every section below. Use **N/A** with a one-line reason, not silence, for a section that genuinely doesn't apply.
3. Add a row for the new ADR to [`ADR-INDEX.md`](ADR-INDEX.md) — that file is the single canonical index; do not maintain a second copy of the list elsewhere.
4. Get the ADR reviewed per `HB-001`'s Documentation Ownership table (authoring engineer + reviewer) before marking it `Decided`.
5. Never delete or silently rewrite a past ADR's decision to hide that it was superseded — add a new ADR and mark the old one's Status as `Superseded by ADR-00NN` instead (`CONST-001` Article X: "The history of why decisions were made should never be lost.").

---

## Template

```markdown
# ADR 00NN: <Decision Title>

**Document ID:** ADR-00NN
**Status:** Proposed | Decided | Deprecated | Superseded by ADR-00NN
**Date:** YYYY-MM-DD
**Owner:** <Authoring engineer>
**Reviewer:** <Reviewing engineer, once reviewed>
**Related Architecture:** <ARCH-001 section(s), or specific subsystem>
**Related Requirements:** <REQ-* IDs, or "None registered yet — pre-REQ-* era">
**Related Documents:** <Other ADRs, database migrations, source paths>

## Context

What situation, constraint, or open question forced this decision? What would happen if no decision were made?

## Decision

What was decided, stated plainly. If the decision has multiple parts, number them.

## Alternatives Considered

What other options were on the table, and why weren't they chosen? An ADR with no alternatives listed either had none worth naming (say so) or wasn't scoped broadly enough before committing.

## Trade-offs

What was given up to get this decision's benefits? Every real decision costs something — name it.

## Consequences

What does this decision make easier, harder, or newly possible? Include effects on other subsystems, not just the one being changed.

## Risks

What could go wrong because of this decision, and how would the team notice? If a risk is accepted rather than mitigated, say that explicitly and why.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | YYYY-MM-DD | Initial decision. |
```
