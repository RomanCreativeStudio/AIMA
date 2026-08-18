import type { WorkspaceService } from '../workspaces/workspaceService';
import type { BriefingService } from './briefingService';
import type { WorkspaceDigestEntry } from './types';

/** Mirrors AIMACore's `DashboardViewModel.nudgeSuggestionSources` exactly — matches `backend/src/proactive/proactiveIntelligenceService.ts`'s `suggestionsFromPatterns` source strings for the three nudge pattern types (Proactive Nudges / Nudge Learning Loop sprints). Kept in sync manually since there is no shared package between the backend and the Swift client. */
const NUDGE_SUGGESTION_SOURCES = new Set([
  'missed_deadline_pattern',
  'blocked_task_stale_pattern',
  'decision_without_followup_pattern',
]);

/**
 * Cross-Workspace Daily Digest sprint: one compact row per workspace the caller owns, so Alex can see what needs
 * attention everywhere without switching the active workspace. Composes `WorkspaceService.listWorkspaces` and
 * `BriefingService.getDailyBriefing` exactly as they already exist — no new pattern detection, no new query
 * shape, no new AI call. Deliberately reads `suggestedNextActions` (the same top-3, already-ranked list each
 * workspace's own Daily Briefing card shows) rather than a second, uncapped `ProactiveIntelligenceService.
 * getSuggestions` call, so a digest row is always consistent with — never wider than — what that workspace's own
 * briefing already displays, and no workspace gets its suggestions computed twice per request.
 */
export class WorkspaceDigestService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly briefingService: BriefingService,
  ) {}

  async getDigest(userId: string): Promise<WorkspaceDigestEntry[]> {
    const workspaces = await this.workspaceService.listWorkspaces(userId);

    return Promise.all(
      workspaces.map(async (workspace): Promise<WorkspaceDigestEntry> => {
        const briefing = await this.briefingService.getDailyBriefing(workspace.id);
        return {
          workspaceId: briefing.workspaceId,
          workspaceName: briefing.workspaceName,
          nudgeCount: briefing.suggestedNextActions.filter((s) => NUDGE_SUGGESTION_SOURCES.has(s.source)).length,
          topSuggestion: briefing.suggestedNextActions[0] ?? null,
          pendingApprovalCount: briefing.pendingApprovalCount,
          greeting: briefing.greeting,
          overdueTaskCount: briefing.overdueTasks.length,
          blockedItemCount: briefing.blockedItems.length,
        };
      }),
    );
  }
}
