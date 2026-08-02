#!/usr/bin/env bash
# Applies every migration in database/migrations/, in numeric order, to a
# target database (EPIC-005 Sprint 5.4). Globs the directory rather than
# hardcoding a file list, so this can never drift out of sync with the real
# migration set the way database/README.md's manual command list once did
# (EPIC-005 Sprint 5.2 found 0016/0017/0019 missing from it).
#
# This is a thin wrapper around the same `psql -v ON_ERROR_STOP=1 -f <file>`
# sequence database/README.md documents running by hand — not a migration
# framework: it does not track which migrations a target database has
# already applied, so it is meant for a fresh database (initial setup),
# exactly like the manual sequence it replaces. Re-running it against an
# already-migrated database will fail on the first already-applied file
# (a real `CREATE TABLE`/`CREATE TYPE` collision, not a bug in this script)
# — that is intentional, not a gap this script tries to paper over.
#
# All migrations run as one `--single-transaction` psql invocation (EPIC-005
# Sprint 5.6), not one `psql` call per file: a failure partway through used
# to leave every migration before the failing one committed, so a retry hit
# an immediate `already exists` collision on those instead of the real
# failure — a half-migrated database a human then had to untangle by hand.
# Verified live: a deliberately-failing run now rolls back to zero tables,
# so fixing the bad migration and re-running lands on a clean database
# again, with nothing to unwind first.
#
# Usage:
#   ./database/apply-migrations.sh postgresql://user:pass@host:5432/dbname
#   DATABASE_URL=postgresql://... ./database/apply-migrations.sh

set -euo pipefail

DATABASE_URL="${1:-${DATABASE_URL:-}}"
if [ -z "$DATABASE_URL" ]; then
  echo "Usage: $0 <DATABASE_URL>  (or set the DATABASE_URL environment variable)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ ${#migrations[@]} -eq 0 ]; then
  echo "No migration files found in $MIGRATIONS_DIR" >&2
  exit 1
fi

# Sort numerically by filename so 0002 always runs before 0019, regardless
# of how the shell glob itself ordered them.
IFS=$'\n' sorted=($(printf '%s\n' "${migrations[@]}" | sort))
unset IFS

file_args=()
for migration in "${sorted[@]}"; do
  echo "Applying $(basename "$migration")..."
  file_args+=(-f "$migration")
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction "${file_args[@]}"

echo "Applied ${#sorted[@]} migration(s) successfully."
