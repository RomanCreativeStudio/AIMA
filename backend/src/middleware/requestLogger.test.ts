import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../logging/types';
import { requestLogger } from './requestLogger';

function fakeLogger(): { logger: Logger; calls: Array<{ message: string; fields?: Record<string, unknown> }> } {
  const calls: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: () => {},
    info: (message, fields) => calls.push({ message, fields }),
    warn: () => {},
    error: () => {},
  };
  return { logger, calls };
}

test('requestLogger logs method, path, and status code once the response finishes', () => {
  const { logger, calls } = fakeLogger();
  const middleware = requestLogger(logger);

  const listeners: Record<string, () => void> = {};
  const req = { method: 'GET', path: '/health' } as Parameters<typeof middleware>[0];
  const res = {
    statusCode: 200,
    on: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
  } as unknown as Parameters<typeof middleware>[1];

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(calls.length, 0);

  listeners.finish();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, 'request');
  assert.equal(calls[0].fields?.method, 'GET');
  assert.equal(calls[0].fields?.path, '/health');
  assert.equal(calls[0].fields?.statusCode, 200);
  assert.equal(typeof calls[0].fields?.durationMs, 'number');
});
