/**
 * The Error Monitoring Foundation's provider abstraction (Phase 3.1) —
 * mirrors `Logger`/`AIProvider`: callers depend only on this interface.
 * The default implementation (`ConsoleErrorReporter`) just logs; a real
 * hosted error-tracking adapter (Sentry, Bugsnag, etc.) is a drop-in later
 * that needs no change to any call site.
 */
export interface ErrorReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
}
