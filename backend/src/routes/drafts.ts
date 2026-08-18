import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import type { DraftService } from '../drafts/draftService';
import { DraftNotFoundError } from '../drafts/errors';
import { DRAFT_CAPABILITY_MAP, DRAFT_TYPES, type DraftType } from '../drafts/types';
import type { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface DraftsRouterDependencies {
  draftService: DraftService;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

/**
 * The Action Preparation Layer's API (Phase 1.7): create/list/get/update/
 * delete for held content — email/proposal/client-response/report drafts.
 * Creation is routed through the PermissionEngine/ActionLogger like any
 * other capability, gated by the capability matching the draft's `type`
 * (docs/decisions/0007-intent-and-approval-workflows.md); update/delete are
 * plain scoped writes, the same foundation-scope decision Task Foundation
 * made in Phase 1.6.
 */
export function draftsRouter(deps: DraftsRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/drafts', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { type, title, content, metadata } = req.body ?? {};

      if (!isDraftType(type)) {
        res.status(400).json({ error: `type must be one of: ${DRAFT_TYPES.join(', ')}` });
        return;
      }
      if (typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      const capability = DRAFT_CAPABILITY_MAP[type];
      const decision = deps.permissionEngine.evaluate(capability);

      let draft;
      try {
        draft = await deps.draftService.createDraft({
          workspaceId,
          type,
          content,
          title: typeof title === 'string' ? title : undefined,
          metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
        });
      } catch (error) {
        if (!(error instanceof WorkspaceNotFoundError)) {
          await deps.actionLogger.log({
            workspaceId,
            tier: deps.permissionEngine.resolveTier(capability),
            summary: `Failed to create a ${type} draft`,
            payload: { error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(capability),
        summary: `Created a ${type} draft`,
        payload: { draftId: draft.id },
        outcome: 'success',
      });

      res.status(201).json({ draft, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/drafts', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const type = isDraftType(req.query.type) ? req.query.type : undefined;
      const drafts = await deps.draftService.listDrafts(workspaceId, type);
      res.json({ drafts });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/drafts/:draftId', async (req, res, next) => {
    try {
      const { workspaceId, draftId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(draftId)) {
        res.status(400).json({ error: 'workspaceId and draftId must be valid UUIDs' });
        return;
      }

      const draft = await deps.draftService.getDraft(workspaceId, draftId);
      res.json({ draft });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.patch('/workspaces/:workspaceId/drafts/:draftId', async (req, res, next) => {
    try {
      const { workspaceId, draftId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(draftId)) {
        res.status(400).json({ error: 'workspaceId and draftId must be valid UUIDs' });
        return;
      }

      const { title, content, metadata } = req.body ?? {};

      if (content !== undefined && (typeof content !== 'string' || content.trim().length === 0)) {
        res.status(400).json({ error: 'content must be a non-empty string if provided' });
        return;
      }

      const draft = await deps.draftService.updateDraft(workspaceId, draftId, {
        title,
        content,
        metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
      });

      res.json({ draft });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.delete('/workspaces/:workspaceId/drafts/:draftId', async (req, res, next) => {
    try {
      const { workspaceId, draftId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(draftId)) {
        res.status(400).json({ error: 'workspaceId and draftId must be valid UUIDs' });
        return;
      }

      await deps.draftService.deleteDraft(workspaceId, draftId);
      res.json({ deleted: true });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isDraftType(value: unknown): value is DraftType {
  return typeof value === 'string' && (DRAFT_TYPES as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof DraftNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
