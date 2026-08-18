import type { SessionService } from '../auth/sessionService';
import type { ConversationService } from '../conversation/conversationService';
import type { IntegrationService } from '../integrations/integrationService';
import type { MemoryService } from '../memory/memoryService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type { UsageMetrics } from './types';

/**
 * Beta Tester Infrastructure sprint: the engagement signals needed to learn from beta testers that
 * `WorkspaceInsights` doesn't already cover (conversations/messages/memories/integrations/last-active).
 * Deliberately a separate service from `WorkspaceInsightsService` rather than folded into it — 19+ files
 * construct `WorkspaceInsightsService` directly across the test suite, and widening its constructor would
 * ripple across all of them for no reason. This composes the same already-existing, already-tested services
 * every other insights class composes; it introduces no new tables.
 */
export class UsageMetricsService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly conversationService: ConversationService,
    private readonly memoryService: MemoryService,
    private readonly integrationService: IntegrationService,
    private readonly sessionService: SessionService,
  ) {}

  async getUsageMetrics(workspaceId: string): Promise<UsageMetrics> {
    const workspace = await this.workspaceService.getWorkspace(workspaceId);

    const [conversations, messagesSent, memoriesCreated, integrations, sessions] = await Promise.all([
      this.conversationService.listConversations(workspaceId),
      this.conversationService.countMessages(workspaceId),
      this.memoryService.countMemories(workspaceId),
      this.integrationService.listForWorkspace(workspaceId),
      this.sessionService.listSessions(workspace.userId),
    ]);

    return {
      workspaceId,
      conversationsCreated: conversations.length,
      messagesSent,
      memoriesCreated,
      integrationsConnected: integrations.filter((integration) => integration.status === 'connected').length,
      // listSessions orders newest-last_seen_at first; the owner's most recent activity across every device,
      // or null for an account with no session recorded yet (a seeded/test account).
      lastActiveAt: sessions[0]?.lastSeenAt ?? null,
      generatedAt: new Date().toISOString(),
    };
  }
}
