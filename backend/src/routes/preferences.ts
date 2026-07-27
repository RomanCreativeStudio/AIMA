import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import { PreferenceNotFoundError } from '../preferences/errors';
import type { PreferenceService } from '../preferences/preferenceService';
import { PREFERENCE_CATEGORIES, type PreferenceCategory } from '../preferences/types';
import type { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface PreferencesRouterDependencies {
  preferenceService: PreferenceService;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

const SET_PREFERENCE_CAPABILITY = 'set_preference';

/**
 * The Preference Memory Layer's API (Phase 1.8): set (upsert)/list/delete
 * over the `preferences` table. Setting is routed through the
 * PermissionEngine/ActionLogger like any other capability; delete is a
 * plain scoped write — the same foundation-scope decision Task/Draft
 * mutations made in earlier phases.
 */
export function preferencesRouter(deps: PreferencesRouterDependencies): Router {
  const router = Router();

  router.put('/workspaces/:workspaceId/preferences', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { category, key, value } = req.body ?? {};

      if (!isPreferenceCategory(category)) {
        res.status(400).json({ error: `category must be one of: ${PREFERENCE_CATEGORIES.join(', ')}` });
        return;
      }
      if (typeof key !== 'string' || key.trim().length === 0) {
        res.status(400).json({ error: 'key is required' });
        return;
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        res.status(400).json({ error: 'value is required' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(SET_PREFERENCE_CAPABILITY);

      let preference;
      try {
        preference = await deps.preferenceService.setPreference({ workspaceId, category, key, value });
      } catch (error) {
        if (!(error instanceof WorkspaceNotFoundError)) {
          await deps.actionLogger.log({
            workspaceId,
            tier: deps.permissionEngine.resolveTier(SET_PREFERENCE_CAPABILITY),
            summary: `Failed to set a ${category} preference`,
            payload: { error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(SET_PREFERENCE_CAPABILITY),
        summary: `Set a ${category} preference`,
        payload: { preferenceId: preference.id, key },
        outcome: 'success',
      });

      res.status(200).json({ preference, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/preferences', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const category = isPreferenceCategory(req.query.category) ? req.query.category : undefined;
      const preferences = await deps.preferenceService.listPreferences(workspaceId, category);
      res.json({ preferences });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.delete('/workspaces/:workspaceId/preferences/:preferenceId', async (req, res, next) => {
    try {
      const { workspaceId, preferenceId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(preferenceId)) {
        res.status(400).json({ error: 'workspaceId and preferenceId must be valid UUIDs' });
        return;
      }

      await deps.preferenceService.deletePreference(workspaceId, preferenceId);
      res.json({ deleted: true });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isPreferenceCategory(value: unknown): value is PreferenceCategory {
  return typeof value === 'string' && (PREFERENCE_CATEGORIES as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof PreferenceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
