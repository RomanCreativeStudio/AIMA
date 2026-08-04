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
  /** Beta Tester Management sprint: admin-only invite notes/tags — see `AdminUserSummary`'s doc comment. */
  adminNotes: string | null;
  adminTags: string[];
}

/**
 * Beta Tester Management sprint: a lightweight row for the "every account, not just current beta testers"
 * admin view — the one used to find a candidate and toggle them into (or out of) the beta, and to record
 * `adminNotes`/`adminTags` about them. Composed from the same `UserProfile.preferences` the Beta User
 * Overview already reads (`betaTester`, plus the two new `adminNotes`/`adminTags` keys this sprint adds) —
 * no new table, no new column; these are ordinary preference keys like `betaTester`/`onboardingCompleted`
 * already are.
 */
export interface AdminUserSummary {
  userId: string;
  email: string;
  displayName: string | null;
  betaTester: boolean;
  /** Free-text invite notes an admin left about this account (e.g. "invited via Discord, follow up 3/1"). */
  adminNotes: string | null;
  /** Internal-only labels (e.g. "power-user", "design-partner") — never shown to the account itself. */
  adminTags: string[];
}

/** The optional fields `AdminService.updateUserBetaStatus` accepts — any subset, applied as a partial
 * update to the account's `preferences` (not a full replace, so unrelated preference keys are preserved). */
export interface UpdateBetaTesterInput {
  betaTester?: boolean;
  adminNotes?: string;
  adminTags?: string[];
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
