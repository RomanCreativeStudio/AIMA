#!/usr/bin/env bash
# Takes a full logical backup of a target database via pg_dump's custom
# format (EPIC-005 Sprint 5.6) — the standard, hosting-platform-agnostic
# recovery mechanism this project didn't have a documented or scripted path
# for before this sprint (TECHNICAL_ARCHITECTURE.md's "regular, automated
# backups... with a tested restore process" requirement, previously
# unaddressed).
#
# This is a thin wrapper around `pg_dump -Fc`, not a scheduling/retention
# system: it takes one backup when run and does not decide when or how
# often to run, upload the result offsite, or prune old backups — those are
# the hosting platform's or operator's job (e.g. a cron entry, or a managed
# Postgres provider's own automated backup feature, which should still be
# enabled once a platform is chosen; this script is the fallback/manual
# path and the thing a scheduled job would call). The custom format (`-Fc`)
# is compressed and includes the `CREATE EXTENSION` statements this
# project's schema depends on (pgcrypto, vector) — restore.sh's pg_restore
# call recreates them automatically, verified against a real local
# pg_dump/pg_restore round-trip (schema, row counts, and pgvector column
# data all matched exactly) during this sprint.
#
# Usage:
#   ./database/backup.sh postgresql://user:pass@host:5432/dbname [output-file]
#   DATABASE_URL=postgresql://... ./database/backup.sh

set -euo pipefail

DATABASE_URL="${1:-${DATABASE_URL:-}}"
if [ -z "$DATABASE_URL" ]; then
  echo "Usage: $0 <DATABASE_URL> [output-file]  (or set the DATABASE_URL environment variable)" >&2
  exit 1
fi

OUTPUT_FILE="${2:-aima-backup-$(date -u +%Y%m%dT%H%M%SZ).dump}"

pg_dump "$DATABASE_URL" -Fc -f "$OUTPUT_FILE"

echo "Backup written to $OUTPUT_FILE"
