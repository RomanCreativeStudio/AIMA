import { Router, type Response } from 'express';
import type { ProactiveIntelligenceService } from '../proactive/proactiveIntelligenceService';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface ProactiveRouterDependencies {
  proactiveIntelligenceService: ProactiveIntelligenceService;
}

/**
 * The Proactive Intelligence Engine's API (Phase 3.5): every route here is a plain GET over freshly-computed,
 * never-persisted analysis — no capability, no `ActionLogger.log`, no `pending_approvals` row, the same
 * "read-only intelligence" rule `insights.ts` follows (Phase 2.5). Nothing behind these routes ever creates,
 * executes, or sends anything; they only describe patterns already in the data and what a user could do next.
 */
export function proactiveRouter(deps: ProactiveRouterDependencies): Router {
  const router = Router();

  router.get('/workspaces/:workspaceId/proactive/patterns', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const patterns = await deps.proactiveIntelligenceService.detectPatterns(workspaceId);
      res.json({ patterns });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/proactive/suggestions', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const suggestions = await deps.proactiveIntelligenceService.getSuggestions(workspaceId);
      res.json({ suggestions });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
