export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Freeform structured context attached to a log line — never logged verbatim if any key looks secret-shaped (see `redact.ts`). */
export type LogFields = Record<string, unknown>;

/**
 * The Logging Configuration's provider abstraction (Phase 3.1) — mirrors
 * `AIProvider`/`EmbeddingProvider`/`OAuthProvider`: callers depend only on
 * this interface, never on a concrete implementation, so a future adapter
 * (e.g. shipping structured logs to a hosted log service) is a drop-in.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
