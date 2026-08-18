import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../logging/types';
import { ConsoleErrorReporter } from './consoleErrorReporter';

function fakeLogger(): { logger: Logger; calls: Array<{ message: string; fields?: Record<string, unknown> }> } {
  const calls: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, fields) => calls.push({ message, fields }),
  };
  return { logger, calls };
}

test('captureException() logs an Error instance with its message and stack', () => {
  const { logger, calls } = fakeLogger();
  const reporter = new ConsoleErrorReporter(logger);

  reporter.captureException(new Error('boom'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, 'boom');
  assert.match(String(calls[0].fields?.stack), /boom/);
});

test('captureException() stringifies a non-Error value', () => {
  const { logger, calls } = fakeLogger();
  const reporter = new ConsoleErrorReporter(logger);

  reporter.captureException('plain string failure');

  assert.equal(calls[0].message, 'plain string failure');
  assert.equal(calls[0].fields?.stack, undefined);
});

test('captureException() merges extra context alongside the stack', () => {
  const { logger, calls } = fakeLogger();
  const reporter = new ConsoleErrorReporter(logger);

  reporter.captureException(new Error('boom'), { requestId: 'r1' });

  assert.equal(calls[0].fields?.requestId, 'r1');
});
