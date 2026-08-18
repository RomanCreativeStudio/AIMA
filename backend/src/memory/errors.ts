/** Thrown for both "no such memory" and "belongs to another workspace" — mirrors ConversationNotFoundError/ExecutionNotFoundError's "don't leak which case it was" reasoning. */
export class MemoryNotFoundError extends Error {
  constructor(memoryId: string, workspaceId: string) {
    super(`Memory ${memoryId} was not found in workspace ${workspaceId}`);
    this.name = 'MemoryNotFoundError';
  }
}
