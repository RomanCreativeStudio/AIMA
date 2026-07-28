import type { ErrorRequestHandler } from 'express';
import type { ErrorReporter } from '../monitoring/types';

/** Builds the terminal error-handling middleware (Phase 3.1: reports via the injected `ErrorReporter` instead of a bare `console.error`, so a future real error-tracking adapter needs no change here). */
export function createErrorHandler(errorReporter: ErrorReporter): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    errorReporter.captureException(err);
    res.status(500).json({ error: 'Internal server error' });
  };
}
