import { rankSuggestions } from '@aima/ai-engine';
import type { IntegrationService } from '../integrations/integrationService';
import type { IntegrationRegistry } from '../integrations/registry';
import type { MemoryService } from '../memory/memoryService';
import type { PatternDetectionService } from './patternDetectionService';
import type { Pattern, Suggestion } from './types';

/** How many `repeated_task` patterns get an accompanying memory-relevance lookup — bounded so a workspace with many recurring keywords doesn't trigger an unbounded number of embedding searches per request. */
const MAX_MEMORY_LOOKUPS = 3;
/** A relevance score below this isn't worth surfacing as "this memory looks related." */
const MEMORY_MATCH_THRESHOLD = 0.5;
/** Not pattern-derived — a flat, modest confidence for "you have an unconnected integration," so pattern-backed suggestions naturally rank above it. */
const INTEGRATION_SUGGESTION_CONFIDENCE = 0.3;
const EXPLANATION_PREVIEW_LENGTH = 80;

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
  ) {}

  async detectPatterns(workspaceId: string): Promise<Pattern[]> {
    return this.patternDetectionService.detect(workspaceId);
  }

  async getSuggestions(workspaceId: string): Promise<Suggestion[]> {
    const patterns = await this.patternDetectionService.detect(workspaceId);

    const suggestions = [
      ...suggestionsFromPatterns(workspaceId, patterns),
      ...(await this.memorySuggestionsFromPatterns(workspaceId, patterns)),
      ...(await this.integrationSuggestions(workspaceId)),
    ];

    return rankSuggestions(suggestions);
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
