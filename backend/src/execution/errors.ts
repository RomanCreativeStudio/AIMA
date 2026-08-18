/** Thrown for both "never existed" and "belongs to another workspace" — mirrors WorkspaceNotFoundError's "don't leak which case it was" reasoning. */
export class ExecutionNotFoundError extends Error {
  constructor(executionId: string, workspaceId: string) {
    super(`Execution ${executionId} was not found in workspace ${workspaceId}`);
    this.name = 'ExecutionNotFoundError';
  }
}

/** Thrown when `actionType` has no registered `ActionExecutor` — an unsupported action, not a missing resource. */
export class ExecutorNotFoundError extends Error {
  constructor(actionType: string) {
    super(`No executor registered for action type: "${actionType}"`);
    this.name = 'ExecutorNotFoundError';
  }
}

/** Thrown by `execute()` when the underlying approval is still 'pending' — re-checked fresh on every call, never trusted from creation time. */
export class ExecutionApprovalNotYetGrantedError extends Error {
  constructor(executionId: string) {
    super(`Execution ${executionId} is still awaiting approval`);
    this.name = 'ExecutionApprovalNotYetGrantedError';
  }
}
