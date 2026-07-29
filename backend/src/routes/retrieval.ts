import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import { EMBEDDING_SOURCE_TYPES, type EmbeddingSourceType } from '../embeddings/types';
import type { RetrievalService } from '../embeddings/retrievalService';
import type { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface RetrievalRouterDependencies {
  retrievalService: RetrievalService;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

const SEARCH_CAPABILITY = 'semantic_search';
const REINDEX_CAPABILITY = 'reindex_embeddings';

/**
 * Semantic retrieval API (Phase 3.6, docs/decisions/
 * 0021-semantic-search-and-context-retrieval.md): similarity search, advisory
 * context assembly, and manual re-indexing over the generic `embeddings`
 * table. Retrieval only — no route here writes a memory, a conversation, or
 * a task. All three routes are permission-gated and workspace-scoped, unlike
 * the read-only routes in memories.ts/documents.ts, per this phase's
 * explicit requirement.
 */
export function retrievalRouter(deps: RetrievalRouterDependencies): Router {
  const router = Router();

  router.get('/workspaces/:workspaceId/retrieval/search', async (req, res, next) => {
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

      const sourceTypes = parseSourceTypes(req.query.sourceTypes);
      if (sourceTypes === 'invalid') {
        res.status(400).json({ error: `sourceTypes must be a comma-separated list of: ${EMBEDDING_SOURCE_TYPES.join(', ')}` });
        return;
      }

      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const decision = deps.permissionEngine.evaluate(SEARCH_CAPABILITY);
      const results = await deps.retrievalService.search({
        workspaceId,
        query: q,
        sourceTypes,
        limit,
      });

      res.json({ results, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/retrieval/context', async (req, res, next) => {
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

      const conversationId = req.query.conversationId;
      if (conversationId !== undefined && (typeof conversationId !== 'string' || !isUuid(conversationId))) {
        res.status(400).json({ error: 'conversationId must be a valid UUID if provided' });
        return;
      }

      const memoryLimit = req.query.memoryLimit ? Number(req.query.memoryLimit) : undefined;
      const embeddingLimit = req.query.embeddingLimit ? Number(req.query.embeddingLimit) : undefined;

      const decision = deps.permissionEngine.evaluate(SEARCH_CAPABILITY);
      const context = await deps.retrievalService.getContext({
        workspaceId,
        query: q,
        conversationId,
        memoryLimit,
        embeddingLimit,
      });

      res.json({ context, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/retrieval/reindex', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(REINDEX_CAPABILITY);

      let result;
      try {
        result = await deps.retrievalService.reindexWorkspace(workspaceId);
      } catch (error) {
        if (!(error instanceof WorkspaceNotFoundError)) {
          await deps.actionLogger.log({
            workspaceId,
            tier: deps.permissionEngine.resolveTier(REINDEX_CAPABILITY),
            summary: 'Failed to re-index workspace embeddings',
            payload: { error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(REINDEX_CAPABILITY),
        summary: 'Re-indexed workspace embeddings',
        payload: {
          conversationsIndexed: result.conversations.length,
          tasksIndexed: result.tasks.length,
        },
        outcome: 'success',
      });

      res.json({ result, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

/** Parses a comma-separated `sourceTypes` query param. `undefined` means "not provided"; `'invalid'` flags a malformed value. */
function parseSourceTypes(value: unknown): EmbeddingSourceType[] | undefined | 'invalid' {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'invalid';
  }
  const values = value.split(',').map((part) => part.trim());
  if (!values.every(isEmbeddingSourceType)) {
    return 'invalid';
  }
  return values;
}

function isEmbeddingSourceType(value: string): value is EmbeddingSourceType {
  return (EMBEDDING_SOURCE_TYPES as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
