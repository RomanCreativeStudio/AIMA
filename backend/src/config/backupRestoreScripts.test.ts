import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// database/backup.sh and database/restore.sh (EPIC-005 Sprint 5.6) are
// plain bash scripts, not TypeScript, so — like apply-migrations.sh before
// them — these structural checks live here rather than in a workspace of
// their own. A real pg_dump/pg_restore round-trip (schema, row counts, and
// a pgvector column's data all matching exactly) was verified manually
// against a live local database during this sprint, not automated here,
// for the same reason applyMigrationsScript.test.ts doesn't run a live
// migration: it would make `npm test` assume `pg_dump`/`pg_restore` are on
// `PATH` wherever it runs, an assumption none of this repo's other tests
// make.

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKUP_SCRIPT = path.join(REPO_ROOT, 'database/backup.sh');
const RESTORE_SCRIPT = path.join(REPO_ROOT, 'database/restore.sh');

test('database/backup.sh is syntactically valid bash', () => {
  execFileSync('bash', ['-n', BACKUP_SCRIPT]);
});

test('database/restore.sh is syntactically valid bash', () => {
  execFileSync('bash', ['-n', RESTORE_SCRIPT]);
});

test('database/backup.sh exits with a clear usage message when no DATABASE_URL is given', () => {
  assert.throws(
    () => execFileSync('bash', [BACKUP_SCRIPT], { env: { ...process.env, DATABASE_URL: '' }, stdio: 'pipe' }),
    /Usage:/,
  );
});

test('database/restore.sh exits with a clear usage message when no arguments are given', () => {
  assert.throws(
    () => execFileSync('bash', [RESTORE_SCRIPT], { env: { ...process.env, DATABASE_URL: '' }, stdio: 'pipe' }),
    /Usage:/,
  );
});

test('database/restore.sh reports a missing backup file clearly instead of letting pg_restore fail obscurely', () => {
  assert.throws(
    () =>
      execFileSync('bash', [RESTORE_SCRIPT, 'postgresql://user:pass@localhost:5432/db', '/nonexistent/backup.dump'], {
        stdio: 'pipe',
      }),
    /Backup file not found/,
  );
});

test('root package.json wires db:backup and db:restore to the scripts', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts['db:backup'], 'bash database/backup.sh');
  assert.equal(pkg.scripts['db:restore'], 'bash database/restore.sh');
});
