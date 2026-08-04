import { rankSuggestions } from '@aima/ai-engine';
import type { ActionLogger, ActionLogRecord } from '../actionLog/logger';
import type { IntegrationService } from '../integrations/integrationService';
import type { IntegrationRegistry } from '../integrations/registry';
import type { MemoryService } from '../memory/memoryService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type { PatternDetectionService } from './patternDetectionService';
import type { NudgeInteractionType, Pattern, Suggestion } from './types';

/** How many `repeated_task` patterns get an accompanying memory-relevance lookup — bounded so a workspace with many recurring keywords doesn't trigger an unbounded number of embedding searches per request. */
const MAX_MEMORY_LOOKUPS = 3;
/** A relevance score below this isn't worth surfacing as "this memory looks related." */
const MEMORY_MATCH_THRESHOLD = 0.5;
/** Not pattern-derived — a flat, modest confidence for "you have an unconnected integration," so pattern-backed suggestions naturally rank above it. */
const INTEGRATION_SUGGESTION_CONFIDENCE = 0.3;
const EXPLANATION_PREVIEW_LENGTH = 80;
/** Nudge Learning Loop sprint: how many days a dismissed suggestion `source` stays suppressed — the sprint's own example ("Blocked task dismissed → hide for 7 days"), applied uniformly and made configurable via the constructor. */
const DEFAULT_NUDGE_COOLDOWN_DAYS = 7;
/** How far back through `action_log` to look for nudge interactions — bounded like `PatternDetectionService`'s `ACTIVITY_SAMPLE_LIMIT`, not an unbounded query. */
const NUDGE_INTERACTION_SAMPLE_LIMIT = 100;
/** Deterministic ranking nudge per net (acted-on minus dismissed) interaction for a suggestion `source` — small and clamped so it adjusts ordering among close suggestions without ever overriding a strong confidence signal. No ML. */
const INTERACTION_RANKING_WEIGHT = 0.05;
const MAX_INTERACTION_BIAS = 0.2;

interface NudgeInteractionSummary {
  dismissedAt?: Date;
  actedOnCount: number;
  dismissedCount: number;
}

/**
 * The Proactive Intelligence Engine (Phase 3.5, item 1): turns
 * `PatternDetectionService`'s deterministic patterns into concrete,
 * explainable `Suggestion`s — recommend a workflow, an execution preview, a
 * task review, a related memory, or connecting an integration. Every
 * output is advisory only: this service never creates a task, never starts
 * a workflow run, never creates an execution request, never saves a
 * memory, and never connects an integration. It only reads existing data
 * and describes what a user could do next (docs/decisions/
 * 0020-proactive-intelligence.md).
 */
export class ProactiveIntelligenceService {
  constructor(
    private readonly patternDetectionService: PatternDetectionService,
    private readonly memoryService: MemoryService,
    private readonly integrationService: IntegrationService,
    private readonly integrationRegistry: IntegrationRegistry,
    /** Nudge Learning Loop sprint: only used to reject an unknown workspace before writing a dismiss/act interaction — `getSuggestions` already gets this check for free via `patternDetectionService.detect`. */
    private readonly workspaceService: WorkspaceService,
    private readonly actionLogger: ActionLogger,
    private readonly nudgeCooldownDays: number = DEFAULT_NUDGE_COOLDOWN_DAYS,
  ) {}

  async detectPatterns(workspaceId: string): Promise<Pattern[]> {
    return this.patternDetectionService.detect(workspaceId);
  }

  async getSuggestions(workspaceId: string): Promise<Suggestion[]> {
    const [patterns, interactions] = await Promise.all([
      this.patternDetectionService.detect(workspaceId),
      this.loadNudgeInteractions(workspaceId),
    ]);

    const suggestions = [
      ...suggestionsFromPatterns(workspaceId, patterns),
      ...(await this.memorySuggestionsFromPatterns(workspaceId, patterns)),
      ...(await this.integrationSuggestions(workspaceId)),
    ];

    const visible = suggestions.filter((suggestion) => !this.isWithinCooldown(interactions.get(suggestion.source)));
    const biased = visible.map((suggestion) => applyInteractionBias(suggestion, interactions.get(suggestion.source)));

    return rankSuggestions(biased);
  }

  /** Advisory only — records that Alex dismissed a nudge so `getSuggestions` suppresses its `source` for `nudgeCooldownDays`. Never deletes or mutates anything; the suggestion itself is recomputed fresh next time, same as every other suggestion. */
  async dismissSuggestion(workspaceId: string, suggestionId: string, source: string): Promise<void> {
    await this.recordNudgeInteraction(workspaceId, suggestionId, source, 'dismissed');
  }

  /** Advisory only — records that Alex acted on a nudge, a positive signal `getSuggestions` uses to rank that `source` slightly higher in the future. */
  async recordActedOn(workspaceId: string, suggestionId: string, source: string): Promise<void> {
    await this.recordNudgeInteraction(workspaceId, suggestionId, source, 'acted_on');
  }

  private async recordNudgeInteraction(
    workspaceId: string,
    suggestionId: string,
    source: string,
    interaction: NudgeInteractionType,
  ): Promise<void> {
    await this.workspaceService.getWorkspace(workspaceId);
    await this.actionLogger.log({
      workspaceId,
      tier: 'suggest',
      summary: interaction === 'dismissed' ? `Dismissed a suggestion (${source})` : `Acted on a suggestion (${source})`,
      payload: { nudgeInteraction: interaction, suggestionId, source },
      outcome: 'success',
    });
  }

  /** Reads `action_log` for this workspace's nudge interaction history (Nudge Learning Loop sprint) — the same "prefer `ActionLogger`, add no new table" approach the sprint asked for; `payload.nudgeInteraction` is the marker `recordNudgeInteraction` writes. */
  private async loadNudgeInteractions(workspaceId: string): Promise<Map<string, NudgeInteractionSummary>> {
    const records = await this.actionLogger.list(workspaceId, NUDGE_INTERACTION_SAMPLE_LIMIT);
    const bySource = new Map<string, NudgeInteractionSummary>();

    for (const record of records) {
      const payload = readNudgeInteractionPayload(record);
      if (!payload) continue;

      const summary = bySource.get(payload.source) ?? { actedOnCount: 0, dismissedCount: 0 };
      if (payload.nudgeInteraction === 'dismissed') {
        summary.dismissedCount += 1;
        const createdAt = new Date(record.createdAt);
        if (!summary.dismissedAt || createdAt > summary.dismissedAt) {
          summary.dismissedAt = createdAt;
        }
      } else {
        summary.actedOnCount += 1;
      }
      bySource.set(payload.source, summary);
    }

    return bySource;
  }

  private isWithinCooldown(summary: NudgeInteractionSummary | undefined): boolean {
    if (!summary?.dismissedAt) return false;
    const cooldownMs = this.nudgeCooldownDays * 24 * 60 * 60 * 1000;
    return Date.now() - summary.dismissedAt.getTime() < cooldownMs;
  }

  /** Only the top `MAX_MEMORY_LOOKUPS` repeated-task patterns get a memory search — an embedding call per pattern, kept bounded. */
  private async memorySuggestionsFromPatterns(workspaceId: string, patterns: readonly Pattern[]): Promise<Suggestion[]> {
    const repeatedTaskPatterns = patterns.filter((pattern) => pattern.type === 'repeated_task').slice(0, MAX_MEMORY_LOOKUPS);
    const suggestions: Suggestion[] = [];

    for (const pattern of repeatedTaskPatterns) {
      const keyword = pattern.metadata.keyword as string;
      const [match] = await this.memoryService.search({ workspaceId, query: keyword, limit: 1 });
      if (!match || match.score < MEMORY_MATCH_THRESHOLD) {
        continue;
      }

      suggestions.push({
        id: `memory:${match.id}`,
        workspaceId,
        type: 'memory',
        title: `Review a memory related to "${keyword}"`,
        explanation: `A stored memory ("${preview(match.content)}") looks related to your recurring "${keyword}" tasks.`,
        confidence: Math.min(pattern.confidence, match.score),
        source: 'repeated_task_memory_match',
        timestamp: new Date().toISOString(),
        payload: { memoryId: match.id, keyword },
      });
    }

    return suggestions;
  }

  private async integrationSuggestions(workspaceId: string): Promise<Suggestion[]> {
    const integrations = await this.integrationService.listForWorkspace(workspaceId);
    const now = new Date().toISOString();

    return integrations
      .filter((integration) => integration.status !== 'connected')
      .map((integration) => {
        const displayName = this.integrationRegistry.get(integration.provider)?.displayName ?? integration.provider;
        return {
          id: `integration:${integration.provider}`,
          workspaceId,
          type: 'integration' as const,
          title: `Connect ${displayName}`,
          explanation: `${displayName} isn't connected yet — connecting it lets AIMA read and, with your approval, act on that account.`,
          confidence: INTEGRATION_SUGGESTION_CONFIDENCE,
          source: 'integration_not_connected',
          timestamp: now,
          payload: { provider: integration.provider },
        };
      });
  }
}

/** Reads back the marker `recordNudgeInteraction` writes into `payload` — `unknown` because `ActionLogRecord.payload` is untyped JSONB, so this is the one place that trusts its shape. */
function readNudgeInteractionPayload(record: ActionLogRecord): { nudgeInteraction: NudgeInteractionType; source: string } | null {
  const payload = record.payload as { nudgeInteraction?: unknown; source?: unknown } | null;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.nudgeInteraction !== 'dismissed' && payload.nudgeInteraction !== 'acted_on') return null;
  if (typeof payload.source !== 'string') return null;
  return { nudgeInteraction: payload.nudgeInteraction, source: payload.source };
}

/** Deterministic, no-ML ranking adjustment (Nudge Learning Loop sprint): a suggestion `source` Alex has acted on more than dismissed gets a small confidence boost; one they've dismissed more than acted on gets a small penalty. Clamped so it can only re-order suggestions of similar strength, never override a strong pattern-derived confidence. */
function applyInteractionBias(suggestion: Suggestion, summary: NudgeInteractionSummary | undefined): Suggestion {
  if (!summary) return suggestion;
  const net = summary.actedOnCount - summary.dismissedCount;
  if (net === 0) return suggestion;
  const bias = Math.max(-MAX_INTERACTION_BIAS, Math.min(MAX_INTERACTION_BIAS, net * INTERACTION_RANKING_WEIGHT));
  const confidence = Math.max(0, Math.min(1, suggestion.confidence + bias));
  return { ...suggestion, confidence };
}

function suggestionsFromPatterns(workspaceId: string, patterns: readonly Pattern[]): Suggestion[] {
  const now = new Date().toISOString();
  const suggestions: Suggestion[] = [];

  for (const pattern of patterns) {
    switch (pattern.type) {
      case 'frequent_workflow': {
        const workflowKey = pattern.metadata.workflowKey as string;
        suggestions.push({
          id: `workflow:${workflowKey}`,
          workspaceId,
          type: 'workflow',
          title: `Run "${workflowKey}" again`,
          explanation: pattern.description,
          confidence: pattern.confidence,
          source: 'frequent_workflow_pattern',
          timestamp: now,
          payload: { workflowKey },
        });
        break;
      }
      case 'recurring_approval': {
        const actionType = pattern.metadata.actionType as string;
        suggestions.push({
          id: `execution:${actionType}`,
          workspaceId,
          type: 'execution',
          title: `Preview another "${actionType}" action`,
          explanation: pattern.description,
          confidence: pattern.confidence,
          source: 'recurring_approval_pattern',
          timestamp: now,
          payload: { actionType },
        });
        break;
      }
      case 'repeated_task': {
        const keyword = pattern.metadata.keyword as string;
        suggestions.push({
          id: `task:${keyword}`,
          workspaceId,
          type: 'task',
          title: `Review recurring "${keyword}" tasks`,
          explanation: pattern.description,
          confidence: pattern.confidence,
          source: 'repeated_task_pattern',
          timestamp: now,
          payload: { keyword, taskIds: pattern.metadata.taskIds },
        });
        break;
      }
      case 'missed_deadline': {
        suggestions.push({
          id: 'task:missed-deadlines',
          workspaceId,
          type: 'task',
          title: 'Review overdue tasks',
          explanation: pattern.description,
          confidence: pattern.confidence,
          source: 'missed_deadline_pattern',
          timestamp: now,
          payload: { taskIds: pattern.metadata.taskIds },
        });
        break;
      }
      case 'blocked_task_stale': {
        suggestions.push({
          id: 'task:blocked-stale',
          workspaceId,
          type: 'task',
          title: 'Review blocked tasks',
          explanation: pattern.description,
          confidence: pattern.confidence,
          source: 'blocked_task_stale_pattern',
          timestamp: now,
          payload: { taskIds: pattern.metadata.taskIds },
        });
        break;
      }
      case 'decision_without_followup': {
        suggestions.push({
          id: 'memory:decisions-without-followup',
          workspaceId,
          type: 'memory',
          title: 'Create tasks for undecided follow-ups',
          explanation: pattern.description,
          confidence: pattern.confidence,
          source: 'decision_without_followup_pattern',
          timestamp: now,
          payload: { memoryIds: pattern.metadata.memoryIds },
        });
        break;
      }
      // 'activity_trend' and 'memory_usage_trend' are informational only — surfaced via detectPatterns(),
      // not translated into an actionable suggestion (there's no single next action a trend implies).
    }
  }

  return suggestions;
}

function preview(content: string): string {
  return content.length > EXPLANATION_PREVIEW_LENGTH ? `${content.slice(0, EXPLANATION_PREVIEW_LENGTH)}…` : content;
}
