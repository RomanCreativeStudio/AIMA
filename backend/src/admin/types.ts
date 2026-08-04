import type { Feedback } from '../feedback/types';

/**
 * Internal Operator Dashboard sprint: everything the "Beta User Overview" table needs for one beta tester,
 * composed entirely from existing services (`UserService`, `WorkspaceService`, `FeedbackService`,
 * `UsageMetricsService`, `WorkspaceInsightsService`, `ExecutionService`, `SessionService`) — no new
 * aggregate storage, no new tables beyond `feedback.status`.
 */
export interface AdminBetaUserSummary {
  userId: string;
  email: string;
  displayName: string | null;
  /** The account's default/primary workspace — `null` for the rare account with none yet. Usage below is
   * summed across *all* of the account's workspaces, not just this one. */
  workspaceId: string | null;
  workspaceName: string | null;
  signupDate: string;
  lastActiveAt: string | null;
  onboardingCompleted: boolean;
  feedbackCount: number;
  usage: AdminUsageSummary;
}

export interface AdminUsageSummary {
  conversationsCreated: number;
  messagesSent: number;
  memoriesCreated: number;
  integrationsConnected: number;
  approvalsUsed: number;
  executionsUsed: number;
}

/** One row in the admin Feedback Dashboard — `Feedback` plus the submitter/workspace context an
 * operator needs that a workspace-scoped `Feedback` read never has to carry. */
export interface AdminFeedbackEntry extends Feedback {
  userEmail: string;
  workspaceName: string;
}
