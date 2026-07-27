/**
 * Shared across any service that scopes work to a workspaceId (memory,
 * conversation, knowledge, ...) — extracted here once a second module
 * needed the identical error (docs/TECHNICAL_ARCHITECTURE.md §6).
 */
export class WorkspaceNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
  }
}
