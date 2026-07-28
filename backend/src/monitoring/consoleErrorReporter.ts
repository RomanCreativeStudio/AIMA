import type { Logger } from '../logging/types';
import type { ErrorReporter } from './types';

/** The default `ErrorReporter` (Phase 3.1) — logs the exception via the injected `Logger` (which already redacts secret-shaped fields) rather than shipping it anywhere external. Registering a real error-tracking service is Integration Sprint scope, same "framework now, live account later" pattern as `docs/decisions/0015-live-integration-providers.md`. */
export class ConsoleErrorReporter implements ErrorReporter {
  constructor(private readonly logger: Logger) {}

  captureException(error: unknown, context?: Record<string, unknown>): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(message, { ...context, stack });
  }
}
