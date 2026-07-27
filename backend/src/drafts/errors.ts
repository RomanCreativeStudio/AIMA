/**
 * Thrown for both "no such id" and "id belongs to a different workspace" —
 * both cases are reported identically, mirroring TaskNotFoundError.
 */
export class DraftNotFoundError extends Error {
  constructor(draftId: string, workspaceId: string) {
    super(`Draft ${draftId} was not found in workspace ${workspaceId}`);
    this.name = 'DraftNotFoundError';
  }
}
