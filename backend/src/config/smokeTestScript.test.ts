import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// scripts/smoke-test.js (EPIC-006 Sprint 6.1) isn't part of either npm
// workspace (it's a plain Node script run against a live deployment, not
// library code), so — like apply-migrations.sh/backup.sh/restore.sh before
// it — these structural checks live here rather than in a workspace of
// their own. A real end-to-end run (all 12 checks passing against a local
// backend instance seeded with a real test user, plus a deliberate
// wrong-password run correctly failing with a non-zero exit code) was
// verified manually during this sprint, not automated here, since that
// would make `npm test` assume a live, seeded backend is reachable
// wherever it runs — an assumption none of this repo's other tests make.

const SCRIPT_PATH = path.join(__dirname, '../../../scripts/smoke-test.js');

test('scripts/smoke-test.js is syntactically valid JavaScript', () => {
  execFileSync('node', ['--check', SCRIPT_PATH]);
});

test('scripts/smoke-test.js exits non-zero with a usage message when required arguments are missing', () => {
  assert.throws(
    () => execFileSync('node', [SCRIPT_PATH], { env: { ...process.env, SMOKE_BASE_URL: '', SMOKE_EMAIL: '', SMOKE_PASSWORD: '' }, stdio: 'pipe' }),
    /Usage:/,
  );
});

test('root package.json wires smoke-test to the script', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'));
  assert.equal(pkg.scripts['smoke-test'], 'node scripts/smoke-test.js');
});
