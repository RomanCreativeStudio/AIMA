import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleLogger } from './consoleLogger';

function captureConsole(fn: () => void): { logLines: string[]; errorLines: string[] } {
  const logLines: string[] = [];
  const errorLines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => logLines.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errorLines.push(args.map(String).join(' '));
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { logLines, errorLines };
}

test('ConsoleLogger writes human-readable lines outside production', () => {
  const logger = new ConsoleLogger('development');
  const { logLines } = captureConsole(() => logger.info('hello', { userId: 'u1' }));

  assert.equal(logLines.length, 1);
  assert.match(logLines[0], /^\[INFO\] hello/);
});

test('ConsoleLogger writes single-line JSON in production', () => {
  const logger = new ConsoleLogger('production');
  const { logLines } = captureConsole(() => logger.info('hello', { userId: 'u1' }));

  assert.equal(logLines.length, 1);
  const parsed = JSON.parse(logLines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'hello');
  assert.equal(parsed.userId, 'u1');
  assert.ok(parsed.timestamp);
});

test('ConsoleLogger routes warn/error through console.error, not console.log', () => {
  const logger = new ConsoleLogger('development');
  const { logLines, errorLines } = captureConsole(() => {
    logger.warn('careful');
    logger.error('broken');
  });

  assert.equal(logLines.length, 0);
  assert.equal(errorLines.length, 2);
});

test('ConsoleLogger redacts secret-shaped fields before logging', () => {
  const logger = new ConsoleLogger('production');
  const { logLines } = captureConsole(() => logger.info('token issued', { accessToken: 'super-secret' }));

  const parsed = JSON.parse(logLines[0]);
  assert.equal(parsed.accessToken, '[REDACTED]');
});
