import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import type { DocumentService } from '../knowledge/documentService';
import { DocumentNotFoundError } from '../knowledge/errors';
import { DOCUMENT_FORMATS, type DocumentFormat } from '../knowledge/types';
import type { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import { isUuid } from '../util/uuid';

export interface DocumentsRouterDependencies {
  documentService: DocumentService;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

const IMPORT_CAPABILITY = 'import_document';
const REINDEX_CAPABILITY = 'reindex_document';
const DELETE_CAPABILITY = 'delete_document';

/**
 * Document ingestion API (docs/decisions/0005-knowledge-ingestion.md):
 * import, list, search, get, re-index, delete. Import/reindex/delete are
 * routed through the PermissionEngine/ActionLogger like memory creation;
 * list/get/search are unauthenticated-but-workspace-scoped reads, matching
 * the existing memories routes.
 */
export function documentsRouter(deps: DocumentsRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/documents', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const { format, content, title, source, tags, version } = req.body ?? {};

      if (!isDocumentFormat(format)) {
        res.status(400).json({ error: `format must be one of: ${DOCUMENT_FORMATS.join(', ')}` });
        return;
      }
      if (typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'content is required' });
        return;
      }
      if (tags !== undefined && (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))) {
        res.status(400).json({ error: 'tags must be an array of strings' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(IMPORT_CAPABILITY);

      let document;
      try {
        document = await deps.documentService.importDocument({
          workspaceId,
          format,
          content,
          title: typeof title === 'string' ? title : undefined,
          source: typeof source === 'string' ? source : undefined,
          tags,
          version: typeof version === 'string' ? version : undefined,
        });
      } catch (error) {
        // A nonexistent workspace has no valid FK target to log against —
        // logging here would itself fail. Let handleKnownErrors map it to 404.
        if (!(error instanceof WorkspaceNotFoundError)) {
          await deps.actionLogger.log({
            workspaceId,
            tier: deps.permissionEngine.resolveTier(IMPORT_CAPABILITY),
            summary: `Failed to import a ${format} document`,
            payload: { error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(IMPORT_CAPABILITY),
        summary: `Imported a ${format} document`,
        payload: { documentId: document.id },
        outcome: 'success',
      });

      res.status(201).json({ document, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/documents', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const documents = await deps.documentService.listDocuments(workspaceId);
      res.json({ documents });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  // Registered before "/documents/:documentId" so "search" is never matched as an id.
  router.get('/workspaces/:workspaceId/documents/search', async (req, res, next) => {
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
      const results = await deps.documentService.search(workspaceId, q, limit);
      res.json({ results });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/documents/:documentId', async (req, res, next) => {
    try {
      const { workspaceId, documentId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(documentId)) {
        res.status(400).json({ error: 'workspaceId and documentId must be valid UUIDs' });
        return;
      }

      const document = await deps.documentService.getDocument(workspaceId, documentId);
      res.json({ document });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/documents/:documentId/reindex', async (req, res, next) => {
    try {
      const { workspaceId, documentId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(documentId)) {
        res.status(400).json({ error: 'workspaceId and documentId must be valid UUIDs' });
        return;
      }

      const { content, version } = req.body ?? {};
      if (content !== undefined && typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string if provided' });
        return;
      }
      if (version !== undefined && typeof version !== 'string') {
        res.status(400).json({ error: 'version must be a string if provided' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(REINDEX_CAPABILITY);
      const document = await deps.documentService.reindexDocument(workspaceId, documentId, { content, version });

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(REINDEX_CAPABILITY),
        summary: 'Re-indexed a document',
        payload: { documentId },
        outcome: 'success',
      });

      res.json({ document, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.delete('/workspaces/:workspaceId/documents/:documentId', async (req, res, next) => {
    try {
      const { workspaceId, documentId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(documentId)) {
        res.status(400).json({ error: 'workspaceId and documentId must be valid UUIDs' });
        return;
      }

      const decision = deps.permissionEngine.evaluate(DELETE_CAPABILITY);
      await deps.documentService.deleteDocument(workspaceId, documentId);

      await deps.actionLogger.log({
        workspaceId,
        tier: deps.permissionEngine.resolveTier(DELETE_CAPABILITY),
        summary: 'Deleted a document',
        payload: { documentId },
        outcome: 'success',
      });

      res.json({ deleted: true, permission: decision });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function isDocumentFormat(value: unknown): value is DocumentFormat {
  return typeof value === 'string' && (DOCUMENT_FORMATS as readonly string[]).includes(value);
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof DocumentNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
