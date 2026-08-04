export const FEEDBACK_TYPES = ['bug', 'feature', 'general'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Beta Tester Infrastructure sprint: a single feedback/bug-report/feature-request submission. */
export interface Feedback {
  id: string;
  workspaceId: string;
  userId: string;
  type: FeedbackType;
  message: string;
  createdAt: string;
}

export interface CreateFeedbackInput {
  workspaceId: string;
  userId: string;
  type?: FeedbackType;
  message: string;
}
