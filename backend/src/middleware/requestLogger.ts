import type { RequestHandler } from 'express';
import type { Logger } from '../logging/types';

/** Logs one line per completed request (Phase 3.1) — method, path, status, duration. Never logs headers/body/query, so no request ever risks leaking a credential into a log line through this path alone. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info('request', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  };
}
