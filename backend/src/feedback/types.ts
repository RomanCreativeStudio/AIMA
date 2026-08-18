export const FEEDBACK_TYPES = ['bug', 'feature', 'general'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Internal Operator Dashboard sprint: triage state for a submission. Every row starts `new`; there is no
 * mutation endpoint yet, so nothing currently advances a row past `new` — the column exists so the admin
 * dashboard has something real to display, not a placeholder. */
export const FEEDBACK_STATUSES = ['new', 'reviewed', 'resolved'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Beta Tester Infrastructure sprint: a single feedback/bug-report/feature-request submission. */
export interface Feedback {
  id: string;
  workspaceId: string;
  userId: string;
  type: FeedbackType;
  status: FeedbackStatus;
  message: string;
  createdAt: string;
}

export interface CreateFeedbackInput {
  workspaceId: string;
  userId: string;
  type?: FeedbackType;
  message: string;
}
