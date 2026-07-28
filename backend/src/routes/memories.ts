import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import { MemoryNotFoundError } from '../memory/errors';
import type { MemoryService } from '../memory/memoryService';
import { MEMORY_SCOPES, MEMORY_TYPES, type MemoryScope, type MemoryType } from '../memory/types';
import type { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface MemoriesRouterDependencies {
  memoryService: MemoryService;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

const CREATE_MEMORY_CAPABILITY = 'create_memory';

/**
 * Memory creation, search, and workspace-context retrieval
 * (docs/TECHNICAL_ARCHITECTURE.md §4–§6). Creation is routed through the
 * PermissionEngine and ActionLogger like any other capability; search/read
 * endpoints are unauthenticated-but-workspace-scoped reads, consistent with
 * this sprint's foundation (no auth yet — see backend/README.md).
 */
export function memoriesRouter(deps: MemoriesRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/memories', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { scope, content, source, conversationId, projectKey, metadata } = req.body ?? {};

      if (typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'content is required' });
        return;
      }
      if (!isMemoryScope(scope)) {
        res.status(400).json({ error: `scope must be one of: ${MEMORY_SCOPES.join(', ')}` });
        return;
      }
      if (conversationId !== undefined && !isUuid(conversationId)) {
        res.status(400).json({ error: 'conversationId must be a valid UUID' });
        return;
      }
      if (scope === 'conversation' && conversationId === undefined) {
        res.status(400).json({ error: 'conversationId is required when scope is "conversation"' });
        return;
      }
      if (scope === 'project' && typeof projectKey !== 'string') {
        res.status(400).json({ error: 'projectKey is required when scope is "project"' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(CREATE_MEMORY_CAPABILITY);

      let memory;
      try {
        memory = await deps.memoryService.createMemory({
          workspaceId,
          scope,
          content,
          source: typeof source === 'string' ? source : undefined,
          conversationId: typeof conversationId === 'string' ? conversationId : undefined,
          projectKey: typeof projectKey === 'string' ? projectKey : undefined,
          metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
        });
      } catch (error) {
        // A nonexistent workspace has no valid FK target to log against —
        // logging here would itself fail. Let handleKnownErrors map it to 404.
        if (!(error instanceof WorkspaceNotFoundError)) {
          await deps.actionLogger.log({
            workspaceId,
            tier: deps.permissionEngine.resolveTier(CREATE_MEMORY_CAPABILITY),
            summary: `Failed to create a ${scope} memory`,
            payload: { error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(CREATE_MEMORY_CAPABILITY),
        summary: `Created a ${scope} memory`,
        payload: { memoryId: memory.id },
        outcome: 'success',
      });

      res.status(201).json({ memory, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/memories/search', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const q = req.query.q;
      if (typeof q !== 'string' || q.trim().length === 0) {
        res.status(400).json({ error: 'query parameter "q" is required' });
        return;
      }

      const scope = isMemoryScope(req.query.scope) ? req.query.scope : undefined;
      const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
      const projectKey = typeof req.query.projectKey === 'string' ? req.query.projectKey : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const results = await deps.memoryService.search({
        workspaceId,
        query: q,
        scope,
        conversationId,
        projectKey,
        limit,
      });

      res.json({ results });
    } catch (error) {
      next(error);
    }
  });

  router.get('/workspaces/:workspaceId/context', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const q = req.query.q;
      if (typeof q !== 'string' || q.trim().length === 0) {
        res.status(400).json({ error: 'query parameter "q" is required' });
        return;
      }

      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const context = await deps.memoryService.getWorkspaceContext(workspaceId, q, limit);

      res.json({ context });
    } catch (error) {
      next(error);
    }
  });

  router.get('/workspaces/:workspaceId/memories', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const scope = isMemoryScope(req.query.scope) ? req.query.scope : undefined;
      const memoryType = isMemoryType(req.query.memoryType) ? req.query.memoryType : undefined;
      const includeArchived = req.query.includeArchived === 'true';
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const memories = await deps.memoryService.listMemories({
        workspaceId,
        scope,
        memoryType,
        includeArchived,
        limit,
      });

      res.json({ memories });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.patch('/workspaces/:workspaceId/memories/:memoryId', async (req, res, next) => {
    try {
      const { workspaceId, memoryId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(memoryId)) {
        res.status(400).json({ error: 'workspaceId and memoryId must be valid UUIDs' });
        return;
      }

      const { content, importanceScore, confidenceScore, metadata } = req.body ?? {};

      if (content !== undefined && (typeof content !== 'string' || content.trim().length === 0)) {
        res.status(400).json({ error: 'content must be a non-empty string if provided' });
        return;
      }
      if (importanceScore !== undefined && !isUnitInterval(importanceScore)) {
        res.status(400).json({ error: 'importanceScore must be a number between 0 and 1' });
        return;
      }
      if (confidenceScore !== undefined && !isUnitInterval(confidenceScore)) {
        res.status(400).json({ error: 'confidenceScore must be a number between 0 and 1' });
        return;
      }
      if (
        content === undefined &&
        importanceScore === undefined &&
        confidenceScore === undefined &&
        metadata === undefined
      ) {
        res.status(400).json({ error: 'at least one field must be provided' });
        return;
      }

      const memory = await deps.memoryService.updateMemory(workspaceId, memoryId, {
        content,
        importanceScore,
        confidenceScore,
        metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
      });

      res.json({ memory });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/memories/:memoryId/archive', async (req, res, next) => {
    try {
      const { workspaceId, memoryId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(memoryId)) {
        res.status(400).json({ error: 'workspaceId and memoryId must be valid UUIDs' });
        return;
      }

      const memory = await deps.memoryService.archiveMemory(workspaceId, memoryId);
      res.json({ memory });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.delete('/workspaces/:workspaceId/memories/:memoryId', async (req, res, next) => {
    try {
      const { workspaceId, memoryId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(memoryId)) {
        res.status(400).json({ error: 'workspaceId and memoryId must be valid UUIDs' });
        return;
      }

      await deps.memoryService.deleteMemory(workspaceId, memoryId);
      res.json({ deleted: true });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && (MEMORY_SCOPES as readonly string[]).includes(value);
}

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof MemoryNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
