import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from './logging/types';
import { createGracefulShutdown, type ClosablePool } from './shutdown';

function fakeLogger(): { logger: Logger; calls: Array<{ level: string; message: string; fields?: Record<string, unknown> }> } {
  const calls: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (message, fields) => calls.push({ level: 'debug', message, fields }),
    info: (message, fields) => calls.push({ level: 'info', message, fields }),
    warn: (message, fields) => calls.push({ level: 'warn', message, fields }),
    error: (message, fields) => calls.push({ level: 'error', message, fields }),
  };
  return { logger, calls };
}

interface FakeServer {
  close: (cb: (err?: Error) => void) => void;
  closeCalls: number;
}

function fakeServer(closeError?: Error): FakeServer {
  const server: FakeServer = {
    closeCalls: 0,
    close(cb: (err?: Error) => void) {
      server.closeCalls += 1;
      cb(closeError);
    },
  };
  return server;
}

function fakePool(endError?: Error): { pool: ClosablePool; endCalls: number } {
  let endCalls = 0;
  const pool: ClosablePool = {
    async end() {
      endCalls += 1;
      if (endError) throw endError;
    },
  };
  return {
    pool,
    get endCalls() {
      return endCalls;
    },
  };
}

function fakeExit(): { exit: (code: number) => void; codes: number[] } {
  const codes: number[] = [];
  return { exit: (code: number) => codes.push(code), codes };
}

test('createGracefulShutdown() closes the server and the pool, then exits 0 on a clean shutdown', async () => {
  const { logger, calls } = fakeLogger();
  const server = fakeServer();
  const { pool } = fakePool();
  const { exit, codes } = fakeExit();

  const shutdown = createGracefulShutdown({ server, pool, logger, exit });
  shutdown('SIGTERM');

  // server.close()'s callback (and everything chained off it) runs
  // synchronously in this fake, but pool.end()'s .then/.finally still need a
  // microtask tick to flush.
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(codes, [0]);
  assert.ok(calls.some((c) => c.level === 'info' && c.message.includes('SIGTERM')));
});

test('createGracefulShutdown() exits 1 when the HTTP server fails to close', async () => {
  const { logger, calls } = fakeLogger();
  const server = fakeServer(new Error('server close failed'));
  const { pool } = fakePool();
  const { exit, codes } = fakeExit();

  const shutdown = createGracefulShutdown({ server, pool, logger, exit });
  shutdown('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(codes, [1]);
  assert.ok(calls.some((c) => c.level === 'error' && c.message.includes('closing HTTP server')));
});

test('createGracefulShutdown() logs but does not crash when the pool fails to close', async () => {
  const { logger, calls } = fakeLogger();
  const server = fakeServer();
  const { pool } = fakePool(new Error('pool end failed'));
  const { exit, codes } = fakeExit();

  const shutdown = createGracefulShutdown({ server, pool, logger, exit });
  shutdown('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(codes, [0]);
  assert.ok(calls.some((c) => c.level === 'error' && c.message.includes('closing database pool')));
});

test('createGracefulShutdown() ignores a second signal while already shutting down', async () => {
  const { logger } = fakeLogger();
  const server = fakeServer();
  const { pool } = fakePool();
  const { exit, codes } = fakeExit();

  const shutdown = createGracefulShutdown({ server, pool, logger, exit });
  shutdown('SIGTERM');
  shutdown('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(codes, [0]);
  assert.equal(server.closeCalls, 1);
});

test('createGracefulShutdown() forces exit if shutdown does not complete before the timeout', async () => {
  const { logger, calls } = fakeLogger();
  // A server that never calls its close callback, simulating a connection
  // that never finishes.
  const server = { close: () => {} };
  const { pool } = fakePool();
  const { exit, codes } = fakeExit();

  const shutdown = createGracefulShutdown({ server, pool, logger, exit, timeoutMs: 5 });
  shutdown('SIGTERM');

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(codes, [1]);
  assert.ok(calls.some((c) => c.level === 'error' && c.message.includes('did not complete')));
});
