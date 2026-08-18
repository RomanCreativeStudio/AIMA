/** Feedback Triage Workflow sprint: thrown by `FeedbackService.updateStatus` when no row matches — mirrors TaskNotFoundError/ConversationNotFoundError. */
export class FeedbackNotFoundError extends Error {
  constructor(feedbackId: string) {
    super(`Feedback ${feedbackId} was not found`);
    this.name = 'FeedbackNotFoundError';
  }
}

/** Thrown when the requested status change isn't one of the allowed forward steps (new -> reviewed -> resolved) — mirrors InvalidWorkflowStateError/InvalidVoiceSessionStateError. */
export class InvalidFeedbackStatusTransitionError extends Error {
  constructor(currentStatus: string, targetStatus: string) {
    super(`Cannot transition feedback from "${currentStatus}" to "${targetStatus}"`);
    this.name = 'InvalidFeedbackStatusTransitionError';
  }
}
