#!/usr/bin/env bash
# Restores a backup.sh dump into a target database (EPIC-005 Sprint 5.6).
# Thin wrapper around `pg_restore`, meant for a fresh/empty target database
# (initial recovery, or standing up a fresh environment from a backup) —
# same posture as apply-migrations.sh: it does not merge into or diff
# against existing data, so restoring into a non-empty database will fail
# on the first colliding object rather than silently overwrite anything.
#
# Usage:
#   ./database/restore.sh postgresql://user:pass@host:5432/dbname backup-file.dump
#   DATABASE_URL=postgresql://... ./database/restore.sh backup-file.dump

set -euo pipefail

if [ $# -eq 2 ]; then
  DATABASE_URL="$1"
  DUMP_FILE="$2"
elif [ $# -eq 1 ] && [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL="${DATABASE_URL}"
  DUMP_FILE="$1"
else
  echo "Usage: $0 <DATABASE_URL> <backup-file>  (or set DATABASE_URL and pass just <backup-file>)" >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "Backup file not found: $DUMP_FILE" >&2
  exit 1
fi

pg_restore -d "$DATABASE_URL" "$DUMP_FILE"

echo "Restored $DUMP_FILE successfully."
