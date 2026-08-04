import { Router, type Response } from 'express';
import type { BriefingService } from '../insights/briefingService';
import type { ConversationIntelligenceService } from '../insights/conversationIntelligenceService';
import type { TaskIntelligenceService } from '../insights/taskIntelligenceService';
import type { UsageMetricsService } from '../insights/usageMetricsService';
import type { WorkspaceInsightsService } from '../insights/workspaceInsightsService';
import { ConversationNotFoundError } from '../conversation/errors';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface InsightsRouterDependencies {
  briefingService: BriefingService;
  taskIntelligenceService: TaskIntelligenceService;
  conversationIntelligenceService: ConversationIntelligenceService;
  workspaceInsightsService: WorkspaceInsightsService;
  /** Beta Tester Infrastructure sprint: optional so every pre-existing call site keeps compiling — `GET /workspaces/:workspaceId/usage` is simply not registered when this is omitted. */
  usageMetricsService?: UsageMetricsService;
}

/**
 * Productivity Intelligence (Phase 2.5): every route here is a plain GET
 * over already-stored data — no capability, no `ActionLogger.log` call,
 * no `pending_approvals` row, mirroring every other pure-read endpoint
 * (`listTasks`, `listApprovals`). "Read-only intelligence" is the phase's
 * own rule, not just a description.
 */
export function insightsRouter(deps: InsightsRouterDependencies): Router {
  const router = Router();

  // Alpha Daily Briefing sprint: `/daily-briefing` is the canonical path going forward — `/briefing` (Phase
  // 2.5) stays mounted, unchanged, purely so no existing caller breaks (no breaking API changes). Both hit
  // the exact same `BriefingService.getDailyBriefing` call; this is deliberately one handler function
  // registered twice, not two aggregations of the same data.
  router.get(['/workspaces/:workspaceId/briefing', '/workspaces/:workspaceId/daily-briefing'], async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const briefing = await deps.briefingService.getDailyBriefing(workspaceId);
      res.json({ briefing });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/task-intelligence', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const taskIntelligence = await deps.taskIntelligenceService.analyze(workspaceId);
      res.json({ taskIntelligence });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/conversations/:conversationId/intelligence', async (req, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(conversationId)) {
        res.status(400).json({ error: 'workspaceId and conversationId must be valid UUIDs' });
        return;
      }

      const conversationIntelligence = await deps.conversationIntelligenceService.analyze(workspaceId, conversationId);
      res.json({ conversationIntelligence });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/insights', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const insights = await deps.workspaceInsightsService.getInsights(workspaceId);
      res.json({ insights });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  // Beta Tester Infrastructure sprint: only registered when usageMetricsService is supplied, so every
  // pre-existing call site of insightsRouter (there is only one, app.ts) keeps working unmodified.
  if (deps.usageMetricsService) {
    const usageMetricsService = deps.usageMetricsService;
    router.get('/workspaces/:workspaceId/usage', async (req, res, next) => {
      try {
        const { workspaceId } = req.params;
        if (!isUuid(workspaceId)) {
          res.status(400).json({ error: 'workspaceId must be a valid UUID' });
          return;
        }

        const usage = await usageMetricsService.getUsageMetrics(workspaceId);
        res.json({ usage });
      } catch (error) {
        handleKnownErrors(error, res, next);
      }
    });
  }

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof ConversationNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
