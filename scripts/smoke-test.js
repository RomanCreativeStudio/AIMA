#!/usr/bin/env node
// Production smoke test (EPIC-006 Sprint 6.1) — a plain Node script (no new
// dependency; Node 22's built-in fetch, the same convention the Dockerfile's
// own HEALTHCHECK already uses) that exercises a deployed AIMA backend's
// real HTTP surface end-to-end. Mirrors the manual curl-driven simulation
// run by hand against a local instance in EPIC-005 Sprint 5.6 — this is
// that same sequence, scripted and reusable against any real deployment.
//
// This is a smoke test, not a full regression suite: it proves the deployed
// instance's auth, workspace, permission, and rate-limiting wiring actually
// works end-to-end against its real configuration (real Supabase project,
// real DATABASE_URL) — the one thing `npm test`'s fixture-based tests can
// never prove, since they never make a live network call.
//
// Usage:
//   node scripts/smoke-test.js <baseUrl> <email> <password>
//   SMOKE_BASE_URL=https://... SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-test.js
//
// The account must already exist (this app has no self-serve sign-up —
// docs/PRODUCTION_SETUP.md §10.5) and must not be one you mind hitting the
// login rate limiter's reset-on-success path a few times during the run.

const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/+$/, '');
const email = process.argv[3] || process.env.SMOKE_EMAIL;
const password = process.argv[4] || process.env.SMOKE_PASSWORD;

if (!baseUrl || !email || !password) {
  console.error('Usage: node scripts/smoke-test.js <baseUrl> <email> <password>');
  console.error('  (or set SMOKE_BASE_URL / SMOKE_EMAIL / SMOKE_PASSWORD)');
  process.exit(1);
}

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, headers: res.headers };
}

async function main() {
  // 1. GET /health
  const health = await req('GET', '/health');
  record(
    '1. GET /health',
    health.status === 200 && health.json?.status === 'ok',
    `HTTP ${health.status}, status="${health.json?.status}"`,
  );

  // 2. Login
  const login = await req('POST', '/api/auth/login', { body: { email, password, deviceLabel: 'smoke-test' } });
  const accessToken = login.json?.tokens?.accessToken;
  const refreshToken = login.json?.tokens?.refreshToken;
  const userId = login.json?.session?.userId;
  record('2. Login', login.status === 201 && Boolean(accessToken) && Boolean(refreshToken), `HTTP ${login.status}`);
  if (!accessToken || !refreshToken || !userId) {
    console.error('\nLogin did not return usable tokens — cannot continue. Aborting remaining steps.');
    return finish();
  }

  // 3. Authenticated API request
  const me = await req('GET', `/api/users/${userId}/workspaces`, { token: accessToken });
  record('3. Authenticated API request', me.status === 200 && Array.isArray(me.json?.workspaces), `HTTP ${me.status}`);

  // Also confirm the same request is rejected with no token, as the other
  // half of "authenticated API request" actually being enforced.
  const meNoAuth = await req('GET', `/api/users/${userId}/workspaces`);
  record('3b. Same request without a token is rejected', meNoAuth.status === 401, `HTTP ${meNoAuth.status}`);

  // 4. Workspace creation (idempotent — reuse an existing one on re-run,
  // since workspace slugs are a fixed enum, not arbitrary strings).
  let workspaceId;
  const createWs = await req('POST', '/api/workspaces', {
    token: accessToken,
    body: { slug: 'personal', name: 'Smoke Test Workspace', type: 'personal' },
  });
  if (createWs.status === 201) {
    workspaceId = createWs.json?.workspace?.id;
    record('4. Workspace creation', Boolean(workspaceId), `HTTP ${createWs.status}, created new`);
  } else {
    const list = await req('GET', `/api/users/${userId}/workspaces`, { token: accessToken });
    workspaceId = list.json?.workspaces?.[0]?.id;
    record(
      '4. Workspace creation',
      Boolean(workspaceId),
      `HTTP ${createWs.status} (already exists — reused workspace ${workspaceId})`,
    );
  }

  // 5. Permission enforcement — a real write returns a PermissionEngine tier
  // decision (not just a bare row), and a cross-tenant read is rejected with
  // the same uniform 404 requireWorkspaceOwnership always returns.
  if (workspaceId) {
    const createTask = await req('POST', `/api/workspaces/${workspaceId}/tasks`, {
      token: accessToken,
      body: { title: 'Smoke test task' },
    });
    record(
      '5. Permission enforcement (tier decision attached to a write)',
      createTask.status === 201 && Boolean(createTask.json?.permission?.kind),
      `HTTP ${createTask.status}, permission.kind="${createTask.json?.permission?.kind}"`,
    );
  } else {
    record('5. Permission enforcement', false, 'skipped — no workspace id available');
  }

  const bogusWorkspace = await req('GET', '/api/workspaces/00000000-0000-0000-0000-000000000000', {
    token: accessToken,
  });
  record(
    '5b. Cross-tenant/unknown workspace access rejected',
    bogusWorkspace.status === 404,
    `HTTP ${bogusWorkspace.status}`,
  );

  // 6. Refresh token rotation
  const refresh1 = await req('POST', '/api/auth/refresh', { body: { refreshToken } });
  const newAccessToken = refresh1.json?.tokens?.accessToken;
  const newRefreshToken = refresh1.json?.tokens?.refreshToken;
  record(
    '6. Refresh token rotation (fresh tokens issued)',
    refresh1.status === 200 && Boolean(newAccessToken) && Boolean(newRefreshToken),
    `HTTP ${refresh1.status}`,
  );
  const refresh2 = await req('POST', '/api/auth/refresh', { body: { refreshToken } });
  record('6b. Reusing the rotated-out refresh token is rejected', refresh2.status === 401, `HTTP ${refresh2.status}`);

  // 7. Logout / revocation
  const activeAccessToken = newAccessToken || accessToken;
  const activeRefreshToken = newRefreshToken || refreshToken;
  const logout = await req('POST', '/api/auth/logout', {
    token: activeAccessToken,
    body: { refreshToken: activeRefreshToken },
  });
  record('7. Logout', logout.status === 204, `HTTP ${logout.status}`);
  const refreshAfterLogout = await req('POST', '/api/auth/refresh', { body: { refreshToken: activeRefreshToken } });
  record(
    '7b. Refresh token rejected after logout (revocation)',
    refreshAfterLogout.status === 401,
    `HTTP ${refreshAfterLogout.status}`,
  );

  // 8. Rate limiting — hammer login with a bogus, throwaway email so the
  // real account's own rate-limit bucket is never touched.
  const rateLimitEmail = `smoke-test-ratelimit-${Date.now()}@invalid.example`;
  let sawRateLimited = false;
  for (let i = 0; i < 10 && !sawRateLimited; i++) {
    const attempt = await req('POST', '/api/auth/login', { body: { email: rateLimitEmail, password: 'wrong' } });
    if (attempt.status === 429) sawRateLimited = true;
  }
  record('8. Rate limiting engages after repeated failed logins', sawRateLimited);

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log('Failed:', failed.map((r) => r.name).join(', '));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
