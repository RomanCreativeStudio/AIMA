import { Router, type Response } from 'express';
import { UserNotFoundError } from '../users/errors';
import type { UserService } from '../users/userService';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface UsersRouterDependencies {
  userService: UserService;
}

/**
 * The User Profile System's API (Phase 1.8): read and update an existing
 * profile. There is no create/registration route — this is a single-user
 * MVP with no auth (docs/PRODUCT_BIBLE.md), so `UserService.createUser`
 * exists for seeding only. Ungated (no PermissionEngine/ActionLogger) —
 * account settings aren't a capability-tiered action, the same reasoning
 * that left Task/Draft update/delete ungated.
 */
export function usersRouter(deps: UsersRouterDependencies): Router {
  const router = Router();

  router.get('/users/:userId', async (req, res, next) => {
    try {
      const { userId } = req.params;
      if (!isUuid(userId)) {
        res.status(400).json({ error: 'userId must be a valid UUID' });
        return;
      }

      const user = await deps.userService.getUser(userId);
      res.json({ user });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.patch('/users/:userId', async (req, res, next) => {
    try {
      const { userId } = req.params;
      if (!isUuid(userId)) {
        res.status(400).json({ error: 'userId must be a valid UUID' });
        return;
      }

      const { displayName, preferences, communicationStyle, defaultWorkspaceId } = req.body ?? {};

      if (displayName !== undefined && typeof displayName !== 'string') {
        res.status(400).json({ error: 'displayName must be a string if provided' });
        return;
      }
      if (preferences !== undefined && (typeof preferences !== 'object' || preferences === null)) {
        res.status(400).json({ error: 'preferences must be an object if provided' });
        return;
      }
      if (communicationStyle !== undefined && typeof communicationStyle !== 'string') {
        res.status(400).json({ error: 'communicationStyle must be a string if provided' });
        return;
      }
      if (defaultWorkspaceId !== undefined && defaultWorkspaceId !== null && !isUuid(defaultWorkspaceId)) {
        res.status(400).json({ error: 'defaultWorkspaceId must be a valid UUID or null' });
        return;
      }

      const user = await deps.userService.updateProfile(userId, {
        displayName,
        preferences,
        communicationStyle,
        defaultWorkspaceId,
      });

      res.json({ user });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof UserNotFoundError || error instanceof WorkspaceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
