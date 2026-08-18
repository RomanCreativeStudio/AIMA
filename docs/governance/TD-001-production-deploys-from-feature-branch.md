# TD 001: Production Deploys From a Long-Lived Feature Branch, Not `main`

**Document ID:** TD-001
**Status:** Identified
**Priority:** Medium
**Category:** Infrastructure
**Owner:** Lead Software Architect

## Description

GitHub's `main` branch (`9eda61a0...`) contains a single commit — the repository's original "Initial commit" — and none of this project's actual development history. Every real commit across all EPICs (Foundation through EPIC-006) lives only on `claude/aima-product-bible-48an4f`. Confirmed during EPIC-006 Sprint 6.5's live production validation: the deployed backend at `https://aima-u7c0.onrender.com` is unambiguously running code from that feature branch (its behavior matches commit `2615aa4`'s auto-provisioning fix, which has never touched `main`), so Render's Web Service must be configured to build from `claude/aima-product-bible-48an4f`, not the repository's nominal default branch. Neither branch has branch protection enabled, and the repository has zero GitHub Actions workflows configured (`actions_list` → `total_count: 0`).

## Reason Introduced

`docs/PRODUCTION_SETUP.md` §10.1's deployment checklist ("Create a new Render Web Service pointed at the repo root `Dockerfile`") never specified which branch to build from, and no sprint ever performed a merge-to-`main` step — all work has simply continued on the one long-lived branch since the Foundation Sprint. This was never a deliberate decision; it's an accumulated gap nobody had reason to notice until this sprint's live validation compared GitHub's branch list against the running deployment.

## Affected Systems

Release process / deployment configuration (Render service → GitHub branch binding); repository structure (`main` vs. `claude/aima-product-bible-48an4f`); anyone auditing "what's in production" by reading `main`, who would be looking at the wrong code entirely.

## Impact

- **False signal**: `main` cannot be used to answer "what code is live in production" — it answers nothing, since it's never been updated past the initial scaffold. Any future contributor, reviewer, or automated tool that assumes `main` is production-representative (a near-universal GitHub convention) will draw wrong conclusions.
- **No branch protection, no CI gate**: neither branch requires review, status checks, or any automated verification before a push takes effect. Render presumably redeploys directly off pushes to the feature branch it's configured against, so a bad push goes straight to production with no gate beyond whatever the pushing session ran locally (`npm test`, `tsc`, etc., not enforced).
- **Fragility**: a force-push, accidental deletion, or branch rename of `claude/aima-product-bible-48an4f` would sever Render's deploy source with no compensating control (no protection rule to prevent it, no second branch mirroring production).

None of this has caused an incident; it is a real single point of process fragility with no active mitigation, not an active defect.

## Risk Level

Medium — not causing current failures, and every prior deployment sprint's validation (Sprint 6.1, Sprint 6.5) confirms the running service works correctly. But the compensating controls a normal `main`-is-production setup provides (protection rules, CI gating, an accurate "what's live" signal) are all absent.

## Recommended Resolution

One of, as a deliberate decision (not a default):

1. **Merge `claude/aima-product-bible-48an4f` into `main`**, repoint Render's Web Service at `main`, and continue future work via short-lived branches merged into `main` — the conventional pattern this repository has never actually used.
2. **Keep the feature branch as the production branch explicitly**, documented as such (this entry, plus a note in `PRODUCTION_SETUP.md`), and add GitHub branch protection (required reviews and/or status checks) directly to it, plus a minimal CI workflow (`npm test`, `tsc --noEmit`, `npm run docs:validate`) gating pushes.

Either resolves the "GitHub shows something different from what's actually running" problem; option 1 is the more conventional and lower-surprise choice for any future collaborator or tool.

## Estimated Effort

Small — a `git merge`/branch rename plus a Render dashboard branch-source change (option 1), or a GitHub branch-protection rule plus a short CI workflow file (option 2). The effort is mechanical; what's been missing is the decision, not the work.

## Related ADRs

`ADR-0025` (First Production Hosting Platform & Database Host) — decided Render as the compute host but did not specify a source branch.

## Related Requirements

None registered yet.

## Related Architecture

`ARCH-001` §8 "Technology Recommendations" (deployment platform); `docs/PRODUCTION_SETUP.md` §10 "First Deployment Checklist."

## Related ECIA

None registered yet.

## Related Risks

None registered yet.

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Lead Software Architect | Initial identification, during EPIC-006 Sprint 6.5's live production validation (config-drift check between GitHub, Render, and Supabase). |
