import { redact } from './redact';
import type { LogFields, LogLevel, Logger } from './types';

/**
 * The default `Logger` (Phase 3.1) — writes to stdout/stderr, structured as
 * one-line JSON in production (what every hosted log platform expects to
 * parse) and as readable text in development/test. Every field passes
 * through `redact` first, regardless of environment.
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly nodeEnv: string = 'development') {}

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    const safeFields = fields ? (redact(fields) as LogFields) : undefined;
    const target = level === 'error' || level === 'warn' ? console.error : console.log;

    if (this.nodeEnv === 'production') {
      target(JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...safeFields }));
      return;
    }
    target(`[${level.toUpperCase()}] ${message}`, safeFields ?? '');
  }
}
