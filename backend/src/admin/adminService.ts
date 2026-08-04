import type { ExecutionService } from '../execution/executionService';
import type { FeedbackService } from '../feedback/feedbackService';
import type { SessionService } from '../auth/sessionService';
import type { UsageMetricsService } from '../insights/usageMetricsService';
import type { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
import type { UserService } from '../users/userService';
import type { UserProfile } from '../users/types';
import type { Workspace } from '../workspaces/types';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type { AdminBetaUserSummary, AdminFeedbackEntry, AdminUsageSummary } from './types';

const ZERO_USAGE: AdminUsageSummary = {
  conversationsCreated: 0,
  messagesSent: 0,
  memoriesCreated: 0,
  integrationsConnected: 0,
  approvalsUsed: 0,
  executionsUsed: 0,
};

/**
 * Internal Operator Dashboard sprint: the founder/admin read model, composed entirely from already-existing
 * services — no duplicate analytics, no new tables beyond `feedback.status` (a display column, not
 * aggregate storage). Every method here reads across every account/workspace by design; that's exactly why
 * this class is only ever reachable via `requireAdmin`-gated routes, never from the regular per-user surface.
 */
export class AdminService {
  constructor(
    private readonly userService: UserService,
    private readonly workspaceService: WorkspaceService,
    private readonly feedbackService: FeedbackService,
    private readonly usageMetricsService: UsageMetricsService,
    private readonly workspaceInsightsService: WorkspaceInsightsService,
    private readonly executionService: ExecutionService,
    private readonly sessionService: SessionService,
  ) {}

  /** Every account marked `preferences.betaTester === true` (`AuthenticationManager.isBetaTester`'s server-side counterpart), newest signup first. */
  async listBetaUsers(): Promise<AdminBetaUserSummary[]> {
    const users = await this.userService.listUsers();
    const betaUsers = users.filter((user) => user.preferences.betaTester === true);
    return Promise.all(betaUsers.map((user) => this.summarizeUser(user)));
  }

  /** The Feedback Dashboard's "latest submissions" feed, enriched with the submitter's email and workspace name — reads `feedback` rows are otherwise anonymous-looking without a join back to `users`/`workspaces`. */
  async listRecentFeedback(limit = 50): Promise<AdminFeedbackEntry[]> {
    const entries = await this.feedbackService.listAllFeedback(limit);

    return Promise.all(
      entries.map(async (entry) => {
        const [user, workspace] = await Promise.all([
          this.userService.getUser(entry.userId),
          this.workspaceService.getWorkspace(entry.workspaceId),
        ]);
        return { ...entry, userEmail: user.email, workspaceName: workspace.name };
      }),
    );
  }

  private async summarizeUser(user: UserProfile): Promise<AdminBetaUserSummary> {
    const [workspaces, feedbackCount, sessions] = await Promise.all([
      this.workspaceService.listWorkspaces(user.id),
      this.feedbackService.countFeedbackForUser(user.id),
      this.sessionService.listSessions(user.id),
    ]);

    const primaryWorkspace = this.primaryWorkspace(user, workspaces);
    const usage = await this.aggregateUsage(workspaces);

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      workspaceId: primaryWorkspace?.id ?? null,
      workspaceName: primaryWorkspace?.name ?? null,
      signupDate: user.createdAt,
      // listSessions orders newest last_seen_at first (SessionService's own doc comment).
      lastActiveAt: sessions[0]?.lastSeenAt ?? null,
      onboardingCompleted: user.preferences.onboardingCompleted === true,
      feedbackCount,
      usage,
    };
  }

  private primaryWorkspace(user: UserProfile, workspaces: readonly Workspace[]): Workspace | null {
    if (workspaces.length === 0) return null;
    return workspaces.find((workspace) => workspace.id === user.defaultWorkspaceId) ?? workspaces[0];
  }

  /** Summed across every one of the account's workspaces — a user with multiple workspaces shouldn't look less active than one with a single workspace just because their activity is spread out. */
  private async aggregateUsage(workspaces: readonly Workspace[]): Promise<AdminUsageSummary> {
    if (workspaces.length === 0) return ZERO_USAGE;

    const perWorkspace = await Promise.all(
      workspaces.map(async (workspace) => {
        const [usage, insights, executions] = await Promise.all([
          this.usageMetricsService.getUsageMetrics(workspace.id),
          this.workspaceInsightsService.getInsights(workspace.id),
          this.executionService.listHistory(workspace.id),
        ]);
        return {
          conversationsCreated: usage.conversationsCreated,
          messagesSent: usage.messagesSent,
          memoriesCreated: usage.memoriesCreated,
          integrationsConnected: usage.integrationsConnected,
          approvalsUsed: insights.approvalMetrics.approved,
          executionsUsed: executions.length,
        };
      }),
    );

    return perWorkspace.reduce(
      (total, current) => ({
        conversationsCreated: total.conversationsCreated + current.conversationsCreated,
        messagesSent: total.messagesSent + current.messagesSent,
        memoriesCreated: total.memoriesCreated + current.memoriesCreated,
        integrationsConnected: total.integrationsConnected + current.integrationsConnected,
        approvalsUsed: total.approvalsUsed + current.approvalsUsed,
        executionsUsed: total.executionsUsed + current.executionsUsed,
      }),
      ZERO_USAGE,
    );
  }
}
