# RISK 003: No Documented or Tested Backup/Restore Capability

**Document ID:** RISK-003
**Status:** Closed
**Severity:** High
**Probability:** High
**Owner:** Lead Software Architect

## Description

Before EPIC-005 Sprint 5.6, this project had no backup or restore tooling and no documentation of one — `docs/PRODUCTION_SETUP.md` didn't mention backups at all, and `database/README.md` covered only forward migration, never recovery. `docs/TECHNICAL_ARCHITECTURE.md` already listed "regular, automated backups of the database and object storage, with a tested restore process" as a stated requirement (§"What 'Done' Looks Like" / similar) and flagged a backup/restore drill as exit criteria for a later "Testing Sprint" — so the gap was known in principle, but nothing had verified that a restore from this schema would actually work, and no script existed for anyone to run one.

## Impact

Every table this project's user, workspace, conversation, task, memory, and integration-credential data lives in had no recovery path if the database were lost, corrupted, or a bad write destroyed data — the standard "irreplaceable user data with no backup" failure mode. Because pgvector's `vector` type and the `pgcrypto`/`vector` extensions this schema depends on aren't universally handled correctly by every backup approach, there was also no confirmation that a naive `pg_dump` would even restore this specific schema cleanly (extension recreation order, HNSW index rebuild, etc.) — an untested recovery process carries real risk of failing exactly when it's needed.

## Detection Method

Not caught by automated monitoring — surfaced by directly auditing for a backup/restore capability during EPIC-005 Sprint 5.6's data durability audit, prompted by the sprint's explicit "review database backup strategy... identify any production data-loss risks" scope.

## Mitigation Strategy

Built and live-verified `database/backup.sh` / `database/restore.sh` (`npm run db:backup` / `npm run db:restore`), thin wrappers around `pg_dump -Fc` / `pg_restore` following the same conventions as `database/apply-migrations.sh`. Verified directly against a real local database seeded with data in a pgvector column: dumped, restored into a fresh database, and confirmed schema (24/24 tables), row counts, and the vector column's data matched exactly, with `CREATE EXTENSION` for `pgcrypto`/`vector` recreated automatically by `pg_restore` — no manual extension setup needed on the target. Documented in `database/README.md` (full detail) and `docs/PRODUCTION_SETUP.md` §3 (operational summary).

Separately, `database/apply-migrations.sh` was hardened to run all migrations inside one `psql --single-transaction`, so a failed migration run now rolls back completely instead of leaving a half-migrated database behind — verified live via a deliberately-failing run.

## Contingency Plan

What remains open, by design, is scheduling: `backup.sh` takes one backup when run, it does not decide when to run, where to store the result, or how long to keep it. As of this sprint, no cron entry or managed-provider automated-backup feature is configured anywhere, so there is still no *standing* backup of any real deployment's data — only a verified, ready-to-use mechanism. This is accepted as out of scope for this sprint (no production deployment or hosting platform exists yet to schedule against) and tracked as a prerequisite for first production launch in `docs/PRODUCTION_SETUP.md`, not as an open item on this risk — re-open a new risk entry if a production deployment goes live without a backup schedule configured.

## Related ADRs

None — this was an operational/tooling gap, not an architectural decision; no ADR was warranted.

## Related Requirements

None formally tracked; `docs/TECHNICAL_ARCHITECTURE.md`'s "regular, automated backups... with a tested restore process" statement and its "Testing Sprint" backup/restore-drill exit criterion are the closest existing references.

## Related Architecture

`docs/TECHNICAL_ARCHITECTURE.md`'s "Testing Sprint" section ("Backup/restore drill: confirm database and storage backups actually restore cleanly") — this sprint performed the first real drill referenced there, ahead of that sprint's formal start, because the tooling to do one didn't exist at all until now.

## Related ECIA

None registered yet.

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Lead Software Architect | Initial identification and mitigation, during EPIC-005 Sprint 5.6's data durability audit: found no backup/restore tooling or documentation existed, built and live-verified `database/backup.sh`/`database/restore.sh` against this schema including its pgvector columns, hardened `apply-migrations.sh` for atomic rollback on failure, and documented both. Status set directly to `Closed` — mitigated within the same investigation, same pattern as `RISK-001`/`RISK-002`. Scheduling a real backup for an actual production deployment remains a documented prerequisite for launch, not a further tracked risk. |
