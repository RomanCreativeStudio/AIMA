import { Router, type Response } from 'express';
import { UserNotFoundError } from '../users/errors';
import { WorkspaceNotFoundError } from '../types/errors';
import { WORKSPACE_SLUGS, WORKSPACE_TYPES, isWorkspaceSlug, isWorkspaceType } from '../types/workspace';
import { WorkspaceAlreadyExistsError } from '../workspaces/errors';
import type { WorkspaceService } from '../workspaces/workspaceService';
import { isUuid } from '../util/uuid';

export interface WorkspacesRouterDependencies {
  workspaceService: WorkspaceService;
}

/**
 * The Workspace Configuration System's API (Phase 1.8): create/get/list/
 * update over the `workspaces` table, which before this phase was only
 * ever seeded directly via SQL. Ungated (no PermissionEngine/ActionLogger)
 * — creating/configuring one of the four fixed workspace kinds is an
 * infrastructure/setup operation, not a conversational capability a user
 * intent would trigger (docs/decisions/0008-user-identity-and-workspace-
 * intelligence.md).
 */
export function workspacesRouter(deps: WorkspacesRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces', async (req, res, next) => {
    try {
      const { userId, slug, name, type, instructions, assistantBehavior, metadata } = req.body ?? {};

      if (!isUuid(userId)) {
        res.status(400).json({ error: 'userId must be a valid UUID' });
        return;
      }
      if (!isWorkspaceSlug(slug)) {
        res.status(400).json({ error: `slug must be one of: ${WORKSPACE_SLUGS.join(', ')}` });
        return;
      }
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      if (type !== undefined && !isWorkspaceType(type)) {
        res.status(400).json({ error: `type must be one of: ${WORKSPACE_TYPES.join(', ')}` });
        return;
      }

      const workspace = await deps.workspaceService.createWorkspace({
        userId,
        slug,
        name,
        type,
        instructions: typeof instructions === 'string' ? instructions : undefined,
        assistantBehavior: typeof assistantBehavior === 'object' && assistantBehavior !== null ? assistantBehavior : undefined,
        metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
      });

      res.status(201).json({ workspace });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/users/:userId/workspaces', async (req, res, next) => {
    try {
      const { userId } = req.params;
      if (!isUuid(userId)) {
        res.status(400).json({ error: 'userId must be a valid UUID' });
        return;
      }

      const workspaces = await deps.workspaceService.listWorkspaces(userId);
      res.json({ workspaces });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const workspace = await deps.workspaceService.getWorkspace(workspaceId);
      res.json({ workspace });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.patch('/workspaces/:workspaceId', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { name, type, instructions, assistantBehavior, metadata } = req.body ?? {};

      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        res.status(400).json({ error: 'name must be a non-empty string if provided' });
        return;
      }
      if (type !== undefined && !isWorkspaceType(type)) {
        res.status(400).json({ error: `type must be one of: ${WORKSPACE_TYPES.join(', ')}` });
        return;
      }
      if (instructions !== undefined && instructions !== null && typeof instructions !== 'string') {
        res.status(400).json({ error: 'instructions must be a string or null if provided' });
        return;
      }

      const workspace = await deps.workspaceService.updateWorkspace(workspaceId, {
        name,
        type,
        instructions,
        assistantBehavior: typeof assistantBehavior === 'object' && assistantBehavior !== null ? assistantBehavior : undefined,
        metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
      });

      res.json({ workspace });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof UserNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof WorkspaceAlreadyExistsError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
