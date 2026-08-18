/**
 * Thrown when a conversationId does not belong to the given workspaceId —
 * either it doesn't exist, or it belongs to a different workspace. Both
 * cases are reported identically so a cross-workspace access attempt
 * (docs/TECHNICAL_ARCHITECTURE.md §6) learns nothing about the other
 * workspace's data, not even that the conversation exists there.
 */
export class ConversationNotFoundError extends Error {
  constructor(conversationId: string, workspaceId: string) {
    super(`Conversation ${conversationId} was not found in workspace ${workspaceId}`);
    this.name = 'ConversationNotFoundError';
  }
}
