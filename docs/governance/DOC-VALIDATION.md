# AIMA Documentation Validation

**Document ID:** DOC-VALIDATION-001
**Document Name:** AIMA Documentation Validation
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational; describes tooling that enforces `HB-001`'s ADS v1.0 and Documentation Review Workflow
**Owner:** Lead Software Architect (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`, `AI-GUIDE-001`
**Dependents:** `AI-GUIDE-001` (Validation Requirements), every future documentation change
**Review Frequency:** Whenever a new governance framework is added, or a check produces a false positive/negative
**Last Updated:** 2026-08-01
**Related Documents:** [`AI-CONTRIBUTOR-GUIDE.md`](AI-CONTRIBUTOR-GUIDE.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../README.md`](../README.md), [`../../scripts/validate-docs.js`](../../scripts/validate-docs.js)

---

## Purpose

`scripts/validate-docs.js` is a zero-dependency Node.js script that checks AIMA's governance documentation against the rules `HB-001` and `AI-GUIDE-001` already establish, so a human or AI contributor doesn't have to re-derive and re-run those checks by hand every sprint. It replaces the ad-hoc "write a Python link-checker one-liner" pattern used across earlier documentation sprints with a single, repeatable, committed tool.

It checks documentation only. It does not run application tests, does not touch `ai-engine/`, `backend/`, `apps/`, or `database/`, and introduces no new npm dependencies — it uses only Node's built-in `fs` and `path` modules.

## What It Checks

1. **Broken internal links** — every Markdown link in every `.md` file (repo-wide, excluding `node_modules/`), resolved relative to the linking file. `http(s)://` and `mailto:` targets are skipped.
2. **Missing ADS metadata fields** — for every `docs/**/*.md` file that declares a `**Document ID:**` and is not a lightweight numbered record (see "Lightweight Records" below), verifies all 11 fields ADS v1.0 requires (`HB-001` §"AIMA Documentation Standard (ADS) v1.0") are present: Document ID, Document Name, Version, Status, Authority Level, Owner, Dependencies, Dependents, Review Frequency, Last Updated, Related Documents. Files that don't declare a Document ID at all (e.g. the historical `ADR-0001`–`ADR-0021` files, which predate ADS by design — see `ADR-TEMPLATE.md`'s scope note) are out of scope for this check, not flagged.
3. **Stable IDs not registered in `HB-001`** — every declared Document ID that is not a lightweight numbered record must appear in `HB-001`'s Master Documentation Index table. Catches a new governance file whose ID was never added to the index.
4. **Documentation index drift** — every `docs/**/*.md` file with a declared Document ID that is not a lightweight numbered record must be referenced by filename somewhere in `docs/README.md`. Catches a new doc that forgot to update the master documentation index.
5. **Invalid governance cross-references** — every backtick-wrapped, ID-shaped token in a document's own `Dependencies`, `Dependents`, or `Related Documents` header fields must either match a real declared Document ID somewhere in the repo, or (for forward references like `ADR-0022` before that ADR exists, or wildcard references like `` `REQ-*` ``) match a prefix registered in `HB-001`'s Permanent Numbering Standard table. Catches a typo'd or invented ID in a cross-reference.

## Lightweight Records

A "lightweight numbered record" is an itemized entry under one of the five record-style prefixes — `ADR-NNN`, `REQ-NNN`, `RISK-NNN`, `TD-NNN`, `ECIA-NNN` (three or four digits) — governed by its own template's lighter header (e.g. `REQ-TEMPLATE.md`'s `Document ID`/`Status`/`Priority`/`Category`/`Owner` block), not the full ADS v1.0 block. This mirrors the convention the historical `ADR-0001`–`ADR-0021` files already established, extended here so it applies uniformly even to records (like `REQ-001`–`REQ-005`) that do declare a `Document ID`. Checks 2–4 exempt these records individually; `HB-001`'s Master Documentation Index and `docs/README.md` register them as a range (e.g. "`ADR-0001+`") via each record family's own `*-INDEX.md`, not one row per record. Canonical governance documents — indexes, templates, and singular artifacts like `HB-001`, `RTM-001`, `AI-GUIDE-001` — are not lightweight records and still require full ADS and individual registration.

## Usage

```bash
node scripts/validate-docs.js
```

Run from the repository root (or via the `npm run docs:validate` script, which does the same thing). Exit code `0` means all five checks passed; exit code `1` means at least one issue was found.

## Failure Output Guidance

The script groups output by check, prints `OK` for a clean check, and lists every individual issue for a failing one. Read the section headers to know which rule was violated, then:

- **Broken internal links** — fix the link target, or the file it should point to; the reported path is resolved exactly as a Markdown renderer would resolve it.
- **Missing ADS metadata fields** — add the missing `**Field:**` line(s) to the document's header block, above the first `---` rule. Use a real value, or `Placeholder` with a reason — never leave it silently absent.
- **Stable IDs not registered in `HB-001`** — add a row for the ID to `HB-001`'s Master Documentation Index table (`docs/PRODUCT_BIBLE.md` §"Master Documentation Index").
- **Documentation index drift** — add a link to the file from `docs/README.md`'s "Start Here" list or Documentation Map table.
- **Invalid governance cross-references** — the token is either a typo (fix it to match the real ID) or a reference to something that was never registered (register it in `HB-001`'s Permanent Numbering Standard, or remove the reference if it doesn't belong).

The script never modifies files — it only reports. Fixes are applied by the contributor, per `AI-GUIDE-001`'s "Do Not Invent" principles: a missing field is filled with a real value or an explicit placeholder, never a fabricated one.

## Scope Boundary

This tool validates documentation structure and cross-reference integrity. It does not, and is not intended to, validate the *content* of a document — whether a described architecture is accurate, whether an ADR's decision is sound, or whether a requirement is well-scoped. Those remain human (or AI-contributor) review judgment calls per `AI-GUIDE-001`.
