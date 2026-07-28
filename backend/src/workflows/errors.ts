/** Thrown for both "no such run" and "run belongs to a different workspace" — both reported identically, mirroring `ConversationNotFoundError`. */
export class WorkflowRunNotFoundError extends Error {
  constructor(runId: string, workspaceId: string) {
    super(`Workflow run ${runId} was not found in workspace ${workspaceId}`);
    this.name = 'WorkflowRunNotFoundError';
  }
}

/** Thrown when an operation (execute/pause/resume/cancel) is attempted from a status it isn't valid from. */
export class InvalidWorkflowStateError extends Error {
  constructor(operation: string, currentStatus: string) {
    super(`Cannot ${operation} a workflow run that is currently "${currentStatus}"`);
    this.name = 'InvalidWorkflowStateError';
  }
}

/** Thrown by `resume` when the blocking step's approval is still pending — the caller should wait for a real decision rather than poll-resuming. */
export class WorkflowApprovalNotYetGrantedError extends Error {
  constructor(runId: string) {
    super(`Workflow run ${runId} is still waiting on its pending approval — resume once it's approved or rejected`);
    this.name = 'WorkflowApprovalNotYetGrantedError';
  }
}
