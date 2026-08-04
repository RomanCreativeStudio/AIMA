import type { ExecutionService } from '../execution/executionService';
import type { FeedbackStatus } from '../feedback/types';
import type { FeedbackService } from '../feedback/feedbackService';
import type { SessionService } from '../auth/sessionService';
import type { UsageMetricsService } from '../insights/usageMetricsService';
import type { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
import type { UserService } from '../users/userService';
import type { UserProfile } from '../users/types';
import type { Workspace } from '../workspaces/types';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type {
  AdminBetaUserSummary,
  AdminFeedbackEntry,
  AdminUsageSummary,
  AdminUserSummary,
  UpdateBetaTesterInput,
} from './types';

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

  /** Every account marked `preferences.betaTester === true` (`AuthenticationManager.isBetaTester`'s server-side counterpart), newest signup first. `query`, if given, is matched case-insensitively against email/displayName (Beta Tester Management sprint). */
  async listBetaUsers(query?: string): Promise<AdminBetaUserSummary[]> {
    const users = await this.userService.listUsers();
    const betaUsers = users.filter((user) => user.preferences.betaTester === true && matchesQuery(user, query));
    return Promise.all(betaUsers.map((user) => this.summarizeUser(user)));
  }

  /**
   * Beta Tester Management sprint: every account (not just current beta testers) as a lightweight row — the
   * view used to find a candidate to promote/demote or annotate, since `listBetaUsers` only ever shows
   * accounts already marked. `query`, if given, is matched case-insensitively against email/displayName.
   */
  async listAllUsers(query?: string): Promise<AdminUserSummary[]> {
    const users = await this.userService.listUsers();
    return users.filter((user) => matchesQuery(user, query)).map(toUserSummary);
  }

  /**
   * Toggles `betaTester` and/or records `adminNotes`/`adminTags` — any subset of `updates`. Reads the
   * account's current `preferences` first and merges the change in, because `UserService.updateProfile`
   * replaces the whole `preferences` column rather than patching it; without this read-merge-write, setting
   * `betaTester` would silently wipe out unrelated keys like `onboardingCompleted`.
   */
  async updateUserBetaStatus(userId: string, updates: UpdateBetaTesterInput): Promise<AdminUserSummary> {
    const user = await this.userService.getUser(userId);
    const preferences = { ...user.preferences };
    if (updates.betaTester !== undefined) preferences.betaTester = updates.betaTester;
    if (updates.adminNotes !== undefined) preferences.adminNotes = updates.adminNotes;
    if (updates.adminTags !== undefined) preferences.adminTags = updates.adminTags;

    const updated = await this.userService.updateProfile(userId, { preferences });
    return toUserSummary(updated);
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

  /** Feedback Triage Workflow sprint: advances a submission's status (delegates the transition rules entirely to `FeedbackService.updateStatus`) and re-enriches it with submitter/workspace context, mirroring `listRecentFeedback`'s shape so the dashboard can patch a single row in place. */
  async updateFeedbackStatus(feedbackId: string, status: FeedbackStatus): Promise<AdminFeedbackEntry> {
    const updated = await this.feedbackService.updateStatus(feedbackId, status);
    const [user, workspace] = await Promise.all([
      this.userService.getUser(updated.userId),
      this.workspaceService.getWorkspace(updated.workspaceId),
    ]);
    return { ...updated, userEmail: user.email, workspaceName: workspace.name };
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
      adminNotes: readAdminNotes(user),
      adminTags: readAdminTags(user),
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

function toUserSummary(user: UserProfile): AdminUserSummary {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    betaTester: user.preferences.betaTester === true,
    adminNotes: readAdminNotes(user),
    adminTags: readAdminTags(user),
  };
}

function readAdminNotes(user: UserProfile): string | null {
  return typeof user.preferences.adminNotes === 'string' ? user.preferences.adminNotes : null;
}

function readAdminTags(user: UserProfile): string[] {
  const tags = user.preferences.adminTags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

function matchesQuery(user: UserProfile, query: string | undefined): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return user.email.toLowerCase().includes(needle) || (user.displayName?.toLowerCase().includes(needle) ?? false);
}
