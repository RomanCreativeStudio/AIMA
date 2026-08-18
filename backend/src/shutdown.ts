import type { Logger } from './logging/types';

export interface ClosableServer {
  close(callback: (error?: Error) => void): void;
}

export interface ClosablePool {
  end(): Promise<void>;
}

export interface GracefulShutdownOptions {
  server: ClosableServer;
  pool: ClosablePool;
  logger: Logger;
  /** How long to wait for in-flight requests/pool close before forcing exit. */
  timeoutMs?: number;
  /** Injectable so tests can observe the resolved exit code without killing the test process. */
  exit?: (code: number) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Builds a signal handler that stops accepting new HTTP connections, lets
 * in-flight requests finish, closes the database pool, then exits — so a
 * rolling deploy or `docker stop` (both send SIGTERM) doesn't abruptly cut
 * off a request or leave a Postgres connection in an unclean state
 * (EPIC-005 Sprint 5.4). A forced-exit timeout guards against a connection
 * that never finishes (a slow client, a hung stream) blocking shutdown
 * indefinitely. A second signal while already shutting down is a no-op —
 * `server.close()`'s callback fires exactly once either way.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions): (signal: string) => void {
  const { server, pool, logger, timeoutMs = DEFAULT_TIMEOUT_MS, exit = process.exit } = options;
  let shuttingDown = false;

  return (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully`);
    const forceExit = setTimeout(() => {
      logger.error(`Graceful shutdown did not complete within ${timeoutMs}ms, forcing exit`);
      exit(1);
    }, timeoutMs);
    forceExit.unref?.();

    server.close((closeError?: Error) => {
      if (closeError) {
        logger.error('Error while closing HTTP server', { error: closeError.message });
      }
      pool
        .end()
        .catch((poolError: Error) => {
          logger.error('Error while closing database pool', { error: poolError.message });
        })
        .finally(() => {
          clearTimeout(forceExit);
          exit(closeError ? 1 : 0);
        });
    });
  };
}
