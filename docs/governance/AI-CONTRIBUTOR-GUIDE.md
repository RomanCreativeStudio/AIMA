# AIMA AI Contributor Guide

**Document ID:** AI-GUIDE-001
**Document Name:** AIMA AI Contributor Guide
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; binding on AI contributors, subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Lead Software Architect (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `ADR-INDEX`, `REQ-INDEX`, `RTM-001`, `ECIA-INDEX`, `RISK-INDEX`, `TD-INDEX`
**Dependents:** Every AI-authored change to this repository (Claude, Codex, and future AI contributors)
**Review Frequency:** Whenever the governance framework it references changes, or an AI-contributor incident reveals a gap
**Last Updated:** 2026-08-01
**Related Documents:** [`../CONSTITUTION.md`](../CONSTITUTION.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md), [`../README.md`](../README.md), [`../decisions/ADR-INDEX.md`](../decisions/ADR-INDEX.md), [`../requirements/REQ-INDEX.md`](../requirements/REQ-INDEX.md), [`../requirements/RTM.md`](../requirements/RTM.md), [`ECIA-INDEX.md`](ECIA-INDEX.md), [`RISK-INDEX.md`](RISK-INDEX.md), [`TD-INDEX.md`](TD-INDEX.md), [`DOC-VALIDATION.md`](DOC-VALIDATION.md)

---

## Purpose

This guide defines how AI agents — Claude, Codex, and any future AI contributor — work in the AIMA repository. It exists because AI contributors do not carry memory between sessions the way a human maintainer does: each session must reconstruct context from the repository itself. This guide is that reconstruction procedure, made explicit, so every AI-authored change follows the same discipline regardless of which agent or session produced it.

It does not introduce new governance authority. Every rule in this guide is drawn from `CONST-001`'s Articles, `HB-001`'s Documentation Review Workflow and Documentation Ownership table, and the working pattern already demonstrated across this repository's actual `ADR-*`/`REQ-*`/`ECIA-*`/`RISK-*`/`TD-*` framework work. Where this guide and a higher-authority document disagree, the higher-authority document wins (`CONST-001` Article IX).

## AI Contributor Responsibilities

An AI contributor working on AIMA is responsible for:

1. Establishing ground truth from the repository before acting, not from a task prompt's claims about the repository.
2. Producing changes that are traceable to a real, verified need — not invented scope.
3. Leaving the documentation hierarchy in a consistent state: correct stable IDs, correct cross-references, correct ADS metadata.
4. Making changes a human reviewer can verify by reading the diff, without having to re-derive what was checked.
5. Stopping and asking rather than guessing when a prompt's premises don't match repository reality (see "Escalation Rules").

## Repository Audit Workflow

Before any substantive change, an AI contributor should:

1. **Read the governance chain in order**: `CONST-001` → `HB-001` → `ARCH-001` → the relevant `ADR-INDEX.md` / `REQ-INDEX.md` / `RTM.md` / `ECIA-INDEX.md` / `RISK-INDEX.md` / `TD-INDEX.md` entries for the area being touched. This mirrors the "Read First" pattern already used by every framework sprint in this repository.
2. **Check actual repository state** — `ls`, `grep`, and direct file reads — for whatever the task claims exists or doesn't exist. A task prompt's description of prior state is a claim, not a fact.
3. **Identify the impacted document IDs** before writing anything (`HB-001`'s Documentation Review Workflow, step 1).
4. **Look for an existing equivalent** before creating a new file, directory, or governance artifact. If one exists, extend it; if a near-equivalent exists in a different location than a prompt requests, prefer the existing location and explain the deviation in the completion report rather than fragmenting the hierarchy.

## Documentation Hierarchy

AIMA's documentation has one authority order, and every AI contributor's changes must respect it:

`CONST-001` (Constitution) → `HB-001` (Engineering Handbook) → `ARCH-001` (Technical Architecture) → `ADR-*` (Architecture Decision Records) → `REQ-*` / `RTM-001` (Requirements and their traceability) → `ECIA-*` / `RISK-*` / `TD-*` (change impact, risk, and technical debt registers) → this guide and other operational documents.

If a document conflicts with one above it in this order, the higher document wins and the lower one must be revised (`CONST-001` Article IX). An AI contributor discovering such a conflict should report it rather than silently resolve it in a direction that suits the current task.

## Decision-Making Rules

- **Trust the repository over the prompt.** When a task's stated premises (an existing file, a described state, a referenced issue) don't match what's actually in the repository or its git history, the repository is authoritative. Report the discrepancy; do not silently comply with the false premise, and do not silently ignore the task.
- **When a requested action and an explicit override instruction in the same task conflict** (for example, "create files at path X" alongside "if an equivalent exists, improve it instead"), the override instruction wins, and the reasoning belongs in the completion report.
- **When genuinely ambiguous and consequential**, ask the human rather than guessing. Use a structured question with the recommended option first, rather than either blocking silently or picking unilaterally.

## Preservation Rules

- **Preserve existing useful content; move it rather than delete it** (`HB-001` Documentation Review Workflow, step 2). Every governance-framework extraction in this repository — ADR list, Requirements Traceability Matrix, ECIA checklist, Risk Register, Technical Debt Register — moved existing content into a canonical file rather than deleting or rewriting it from scratch.
- **Never rewrite history to hide that something was superseded.** Mark the old entry `Superseded by <ID>` or `Deprecated` and add the new one; do not edit the old text to pretend it always said the new thing (`CONST-001` Article X: "The history of why decisions were made should never be lost").
- **Refactor before rewrite.** Prefer targeted edits over full-file rewrites when the existing structure is sound; a rewrite should be a deliberate choice, not a default.
- **Investigate before removing or overwriting unfamiliar state.** Untracked files, unexpected branches, or diverged remote history may represent someone else's in-progress work — inspect (`git log`, `git show`) before deciding whether to keep, merge, or discard.

## "Do Not Invent" Principles

- Do not invent requirements, ADRs, risks, technical debt items, architecture decisions, or historical facts that don't exist in the repository. Where the task requires content that doesn't exist yet, use **Placeholder** or **N/A with a one-line reason** — never a plausible-sounding fabrication.
- Do not invent citations to governance rules. If a rule is attributed to `CONST-001` or `HB-001`, it must be a real, verifiable passage — quote or closely paraphrase it, and check the source text before citing it.
- Do not backfill missing structure (alternatives considered, risks, trade-offs) onto historical records that predate a template requiring it. Apply new templates going forward; note the scope boundary explicitly rather than retrofitting invented detail onto past decisions.

## Change Scope Control

- Match the scope of a change to what was actually requested; do not use a task as license for unrelated cleanup, refactors, or scope expansion.
- No application code, architecture, database, or API changes when a task is explicitly documentation-only — treat stated constraints as hard boundaries, not suggestions.
- A single task should produce a coherent, reviewable diff. If a task's scope naturally splits into independent parts, prefer sequential, individually-validated commits over one large uncheckable change.

## Validation Requirements

Before any commit, run and confirm clean:

1. `git diff --check` — whitespace and formatting.
2. `node scripts/validate-docs.js` (`DOC-VALIDATION-001`) — broken internal links, missing ADS metadata, stable IDs unregistered in `HB-001`'s Master Documentation Index, documentation index drift against `docs/README.md`, and invalid cross-references between governance documents. See [`DOC-VALIDATION.md`](DOC-VALIDATION.md) for failure-output guidance.
3. A manual review of `git status` / `git diff --stat` to confirm the change set matches intent — no unrelated files, no accidental staging.

## Testing Expectations

- Documentation-only changes are validated per "Validation Requirements" above, not by a test suite.
- Changes that touch application code, schemas, or APIs must be validated with the repository's existing build and test commands for the affected package (see `docs/DEVELOPMENT_SETUP.md`, `DEV-001`) before being reported as complete. Claiming a change works without running the applicable checks is not acceptable.

## Commit Standards

- Create commits only for actual, verified changes — never fabricate a commit's description of what changed.
- Write commit messages that state what changed and why, referencing the stable document IDs affected.
- Before pushing, fetch the target branch and check for divergence. If the remote has commits the local branch doesn't, inspect them (`git log`, `git show`) to determine whether they're legitimate work before deciding how to reconcile — never force-push over unreviewed remote history.
- Never use `--no-verify`, `--no-gpg-sign`, or other hook/verification bypasses unless a human explicitly requests it for that specific commit.

## Reporting Format

Every substantive task should conclude with a completion report covering:

- **Repository Audit** — what was actually found in the repository before changes were made, including any discrepancy between the task's premises and reality.
- **Files Created** / **Files Updated** — an explicit list, not a vague summary.
- **Validation Results** — the actual output of the checks in "Validation Requirements" (or "Testing Expectations" where applicable), not an assumption that they would pass.
- **Recommendations** — genuine follow-up items, not filler.

## Escalation Rules

Escalate to the human (via a direct question, not a silent choice) when:

- A task's stated premises conflict with verified repository or git-history state, and the correct interpretation is not obvious.
- A task requests an action with a large blast radius or limited reversibility (force-push, deleting tracked files, rewriting published history, destructive database operations) that wasn't explicitly pre-authorized.
- Two authoritative documents conflict in a way this guide's Decision-Making Rules don't resolve.
- Completing the task as literally written would require inventing content this guide prohibits inventing.

Do not escalate for routine judgment calls within an already-established pattern (for example, which existing directory a new governance-framework file belongs in) — make the call, and explain it in the completion report.

## Human Approval Boundaries

An AI contributor may, without additional per-action confirmation beyond the task itself:

- Read any file, run read-only repository inspection commands, and create local commits on the designated working branch.
- Push commits to the specific branch a task or session designates, after the divergence check in "Commit Standards."

An AI contributor must get explicit human confirmation before:

- Force-pushing, rewriting published git history, or discarding uncommitted work that wasn't authored in the current session.
- Opening a pull request, unless the human explicitly asked for one.
- Taking any action against a shared system beyond this repository (external services, third-party APIs, other repositories) that a task did not explicitly authorize.
- Making a change outside the scope or branch a task or session explicitly designated.
