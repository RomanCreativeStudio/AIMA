import type { IntegrationCredentials, IntegrationProvider } from '../integrations/types';

export const EXECUTION_STATUSES = ['pending', 'awaiting_approval', 'succeeded', 'failed'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** Terminal statuses — once reached, `ExecutionService.execute` is a no-op idempotent read, never re-contacting the provider. */
export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = ['succeeded', 'failed'];

export type ExecutionRequestPayload = Record<string, unknown>;

/** One persisted `executions` row. */
export interface ExecutionRecord {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  actionType: string;
  status: ExecutionStatus;
  requestPayload: ExecutionRequestPayload;
  responseSummary: Record<string, unknown> | null;
  errorDetails: string | null;
  pendingApprovalId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionRequestInput {
  workspaceId: string;
  actionType: string;
  payload: ExecutionRequestPayload;
}

/** A pure, read-only preview (Phase 2.6, item 5) — never persists anything. */
export interface ExecutionPreview {
  actionType: string;
  provider: IntegrationProvider;
  tier: string;
  requiresApproval: boolean;
  integrationConnected: boolean;
  /** Live provider metadata (Phase 2.7, item 7) — when the connected integration's OAuth token expires, or null if it doesn't (or nothing is connected). Never the token itself. */
  tokenExpiresAt: string | null;
  payload: ExecutionRequestPayload;
}

/** What one `ActionExecutor.execute` call needs — the already-decrypted credentials for its provider, resolved by `ExecutionService` immediately before the call, never cached. */
export interface ExecutorContext {
  workspaceId: string;
  payload: ExecutionRequestPayload;
  credentials: IntegrationCredentials;
}

export interface ExecutionOutcome {
  responseSummary: Record<string, unknown>;
}

/**
 * One provider-specific action (Phase 2.6, item 1) — mirrors the
 * `WorkflowHandler`/`IntegrationConnector` provider-abstraction pattern.
 * `ExecutionService` depends only on this interface, never on a concrete
 * Gmail/GitHub executor class.
 */
export interface ActionExecutor {
  readonly actionType: string;
  readonly provider: IntegrationProvider;
  execute(context: ExecutorContext): Promise<ExecutionOutcome>;
}

/** An advisory execution preview attached to a chat response (Phase 2.6, item 5) — never itself creates or runs an execution. */
export interface ExecutionSuggestion {
  actionType: string;
  provider: IntegrationProvider;
  confidence: number;
  extractedPayload: ExecutionRequestPayload;
}
