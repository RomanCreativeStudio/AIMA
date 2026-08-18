import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { ipKey, normalizeEmail, RateLimiter, rateLimitMiddleware } from './rateLimit';

test('consume allows attempts up to max', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, true);
});

test('consume rejects the attempt once max is exceeded', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, true);

  const third = limiter.consume('a');
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds > 0);
});

test('consume isolates different keys from each other', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, false);
  // A different key has never been consumed — its own budget is untouched.
  assert.equal(limiter.consume('b').allowed, true);
});

test('consume resets once the window elapses', () => {
  let now = 0;
  const limiter = new RateLimiter({ windowMs: 1000, max: 1, now: () => now });

  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, false);

  now = 1001; // past the window
  assert.equal(limiter.consume('a').allowed, true);
});

test('reset clears a bucket so the next consume starts fresh', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, false);

  limiter.reset('a');
  assert.equal(limiter.consume('a').allowed, true);
});

test('reset on an unknown key is a no-op, not an error', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
  assert.doesNotThrow(() => limiter.reset('never-consumed'));
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  User@Example.com  '), 'user@example.com');
});

async function withMiddlewareTestServer(
  limiter: RateLimiter,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.get('/protected', rateLimitMiddleware(limiter, ipKey), (_req, res) => {
    res.json({ ok: true });
  });

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('rateLimitMiddleware allows requests through under the limit', async () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 2 });
  await withMiddlewareTestServer(limiter, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/protected`);
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/protected`);
    assert.equal(second.status, 200);
  });
});

test('rateLimitMiddleware responds 429 with Retry-After once the limit is exceeded', async () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
  await withMiddlewareTestServer(limiter, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/protected`);
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/protected`);
    assert.equal(second.status, 429);
    assert.ok(second.headers.get('retry-after'));
    const body = (await second.json()) as { error: string };
    assert.equal(body.error, 'Too many attempts. Try again later.');
  });
});
