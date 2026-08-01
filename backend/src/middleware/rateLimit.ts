import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimiterOptions {
  /** How long a bucket counts attempts before resetting, in milliseconds. */
  windowMs: number;
  /** Attempts allowed within `windowMs` before `consume` reports `allowed: false`. */
  max: number;
  /** Injectable clock, so tests can control window expiry without a real sleep — mirrors the `fetchFn` injection pattern already used by `SupabaseAuthProvider`/`GitHubOAuthProvider`. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A small, self-contained, in-process fixed-window counter (ADR-0023) —
 * the "simplest production-appropriate design" for AIMA's current
 * single-backend-instance architecture (`ARCH-001` §3: "A single backend
 * service"). No Redis or other distributed store: this process is the only
 * writer, so an in-memory `Map` is sufficient and adds no new
 * infrastructure or dependency, consistent with `ARCH-001` §8's guiding
 * rule that solo-developer operational surface is the scarcest resource.
 *
 * Fixed-window, not sliding-window or a token bucket: simpler to reason
 * about and test, and the imprecision at a window boundary (a caller could
 * in principle get `2 * max` attempts across a boundary) is an accepted
 * trade-off for a single-account system defending against credential
 * stuffing, not a precise API-billing throttle.
 *
 * Callers own key construction (IP, IP+email, etc.) — this class only
 * tracks counts per opaque string key.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.now = options.now ?? Date.now;

    // Bounds memory growth from stale keys (old IPs/emails that never come
    // back) without needing an external store — the only cleanup an
    // in-process counter needs. `unref()` so this timer never keeps the
    // process alive on its own (matters for tests and graceful shutdown).
    this.sweepTimer = setInterval(() => this.sweep(), this.windowMs).unref();
  }

  /** Records one attempt for `key`. Returns whether it's allowed and, if not, how long until the window resets. */
  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const retryAfterSeconds = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));

    if (bucket.count > this.max) {
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds };
  }

  /** Clears `key`'s bucket entirely — used to implement "successful authentication resets counters" (REQ-001 criterion 5) without waiting out the window. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Stops the background sweep. Only needed by tests that construct a `RateLimiter` per test case and want a clean process exit; production instances live for the process lifetime. */
  stop(): void {
    clearInterval(this.sweepTimer);
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Express middleware factory over a `RateLimiter` (ADR-0023). Mirrors the
 * rest of this codebase's middleware shape (`requireAuth`,
 * `requireUserOwnership`): a function that takes its dependencies and
 * returns a `RequestHandler`. Responds 429 with a `Retry-After` header
 * (REQ-001-PLAN's Failure Scenarios table: "Rate limit exceeded on an auth
 * endpoint | Reject with 429") when the caller's key is over budget;
 * otherwise calls `next()`. Deliberately returns the same generic message
 * regardless of which limiter/key tripped, so the response itself can't be
 * used to distinguish "this IP is throttled" from "this account is
 * throttled" (avoids leaking account existence, REQ-001 criterion 5).
 */
export function rateLimitMiddleware(limiter: RateLimiter, keyFn: (req: Request) => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const { allowed, retryAfterSeconds } = limiter.consume(keyFn(req));
    if (!allowed) {
      respondRateLimited(res, retryAfterSeconds);
      return;
    }
    next();
  };
}

/**
 * The same 429 response `rateLimitMiddleware` sends, exported so a route
 * handler can apply a second, request-body-derived limiter (e.g. login's
 * per-email check, which needs the parsed body and so can't run as
 * path-level middleware ahead of `express.json()`'s handler) with an
 * identical response shape — one generic message regardless of which
 * limiter tripped, so the response can't be used to distinguish "this IP
 * is throttled" from "this account is throttled."
 */
export function respondRateLimited(res: Response, retryAfterSeconds: number): void {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: 'Too many attempts. Try again later.' });
}

/** The client IP `rateLimitMiddleware` keys on by default — relies on Express's `trust proxy` setting (`backend/src/app.ts`) to resolve the real caller behind a reverse proxy in production, per `ARCH-001` §8's managed-hosting recommendations (Fly.io/Render/Vercel all terminate TLS at an edge proxy). */
export function ipKey(req: Request): string {
  return req.ip ?? 'unknown';
}

/** Normalizes an email the same way `mockSubjectIdFor`/`mockPasswordFor` do (`backend/src/auth/mockAuthProvider.ts`), so the same account maps to the same rate-limit bucket regardless of casing/whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The three `RateLimiter` instances the public auth surface needs (ADR-0023) — constructed once in `index.ts`'s composition root and injected into `authPublicRouter`, the same DI pattern as every other service in `AppDependencies`. */
export interface AuthRateLimiters {
  loginEmail: RateLimiter;
  loginIp: RateLimiter;
  refreshIp: RateLimiter;
}

export interface AuthRateLimitConfig {
  /** Keyed by normalized email, independent of source IP — the primary credential-stuffing defense (ADR-0023): catches a distributed attack against the one real account regardless of which IP it comes from. */
  loginByEmail: RateLimiterOptions;
  /** Keyed by source IP — a coarse backstop against a flood of login requests (malformed or otherwise) that never accumulates against any single email bucket. */
  loginByIp: RateLimiterOptions;
  /** Keyed by source IP — `POST /api/auth/refresh` carries no email to key on; a stolen/reused refresh token is already caught by `SessionService.refresh`'s reuse detection, so this is purely a resource-exhaustion backstop. */
  refreshByIp: RateLimiterOptions;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** Reads `AUTH_*_RATE_LIMIT_*` from process.env, defaulting to 5/15min (login-by-email), 20/15min (login-by-IP), 20/15min (refresh-by-IP) — same shape as `createAuthProviderFromEnv` (`backend/src/auth/registry.ts`): a dedicated small reader with safe defaults, not part of `loadConfig`'s fail-fast required set, since every default here keeps the app secure and running without any operator action. */
export function authRateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthRateLimitConfig {
  return {
    loginByEmail: {
      windowMs: Number(env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS ?? FIFTEEN_MINUTES_MS),
      max: Number(env.AUTH_LOGIN_RATE_LIMIT_MAX ?? 5),
    },
    loginByIp: {
      windowMs: Number(env.AUTH_LOGIN_IP_RATE_LIMIT_WINDOW_MS ?? FIFTEEN_MINUTES_MS),
      max: Number(env.AUTH_LOGIN_IP_RATE_LIMIT_MAX ?? 20),
    },
    refreshByIp: {
      windowMs: Number(env.AUTH_REFRESH_RATE_LIMIT_WINDOW_MS ?? FIFTEEN_MINUTES_MS),
      max: Number(env.AUTH_REFRESH_RATE_LIMIT_MAX ?? 20),
    },
  };
}
