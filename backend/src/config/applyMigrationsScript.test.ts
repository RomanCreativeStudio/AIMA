import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// database/apply-migrations.sh (EPIC-005 Sprint 5.4) isn't part of either
// npm workspace (it's a plain bash script, not TypeScript), so it has no
// home of its own to be tested from — these structural checks live here
// instead, next to deploymentReadiness.test.ts's similar "keep the
// deployment tooling honest about what's really in the repo" checks. Real
// end-to-end verification (applying every migration to a fresh Postgres
// database and confirming all 24 tables exist) was done manually against a
// live database during this sprint, not automated here, since that would
// make `npm test` assume `psql`/`createdb` are on `PATH` wherever it runs —
// an assumption none of this repo's other tests make.

const REPO_ROOT = path.join(__dirname, '../../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'database/apply-migrations.sh');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database/migrations');

test('database/apply-migrations.sh is syntactically valid bash', () => {
  // `bash -n` parses without executing — catches a typo breaking the script
  // without needing a database to run it against.
  execFileSync('bash', ['-n', SCRIPT_PATH]);
});

test('database/apply-migrations.sh exits with a clear usage message when no DATABASE_URL is given', () => {
  assert.throws(
    () => execFileSync('bash', [SCRIPT_PATH], { env: { ...process.env, DATABASE_URL: '' }, stdio: 'pipe' }),
    /Usage:/,
  );
});

test('database/apply-migrations.sh globs every real migration file, in numeric order', () => {
  const expected = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.ok(expected.length > 0, 'expected at least one migration file to exist');

  // Mirrors the script's own sort step (`printf '%s\n' ... | sort`) against
  // the real directory contents, so this fails the moment a migration is
  // added with a name that would sort out of numeric order (e.g. missing
  // zero-padding) — the exact class of bug the script's glob-and-sort
  // approach exists to avoid needing a human to catch by eye.
  const sorted = [...expected].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(expected, sorted);
});

test('root package.json wires db:migrate to the script', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts['db:migrate'], 'bash database/apply-migrations.sh');
});
