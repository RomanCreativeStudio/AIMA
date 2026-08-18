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

/**
 * Thrown when the configured `SpeechToTextProvider`/`TextToSpeechProvider`
 * fails or times out (Phase 3.3) — wraps whatever the provider threw with a
 * safe, generic message so a real vendor's raw error body (which could
 * include request-identifying detail) never reaches the HTTP response;
 * `cause` still carries the original error for server-side logging.
 */
export class VoiceProviderError extends Error {
  constructor(
    public readonly operation: 'speech-to-text' | 'text-to-speech',
    cause: unknown,
  ) {
    super(`The ${operation} provider failed to process this request`, { cause });
    this.name = 'VoiceProviderError';
  }
}
