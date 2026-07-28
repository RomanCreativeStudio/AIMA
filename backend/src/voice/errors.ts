/** Thrown for both "no such session" and "session belongs to another workspace" — mirrors ConversationNotFoundError/ExecutionNotFoundError's "don't leak which case it was" reasoning. */
export class VoiceSessionNotFoundError extends Error {
  constructor(voiceSessionId: string, workspaceId: string) {
    super(`Voice session ${voiceSessionId} was not found in workspace ${workspaceId}`);
    this.name = 'VoiceSessionNotFoundError';
  }
}

/** Thrown when ending an already-ended session, or submitting a voice request against one — mirrors InvalidWorkflowStateError. */
export class InvalidVoiceSessionStateError extends Error {
  constructor(operation: string, currentStatus: string) {
    super(`Cannot ${operation} a voice session that is currently "${currentStatus}"`);
    this.name = 'InvalidVoiceSessionStateError';
  }
}
