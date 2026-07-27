import { Router, type Response } from 'express';
import type { ConversationService } from '../conversation/conversationService';
import { ConversationNotFoundError, WorkspaceNotFoundError } from '../conversation/errors';
import { isUuid } from '../util/uuid';

export interface ConversationsRouterDependencies {
  conversationService: ConversationService;
}

/**
 * The conversation pipeline's HTTP surface (docs/TECHNICAL_ARCHITECTURE.md
 * §4, §7): create a conversation, read its history, and send a message
 * through the full User Input → Memory Retrieval → AI Provider → Storage
 * pipeline. Workspace isolation is enforced by ConversationService, not
 * re-implemented here.
 */
export function conversationsRouter(deps: ConversationsRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/conversations', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
      const conversation = await deps.conversationService.createConversation(workspaceId, title);
      res.status(201).json({ conversation });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(conversationId)) {
        res.status(400).json({ error: 'workspaceId and conversationId must be valid UUIDs' });
        return;
      }

      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const messages = await deps.conversationService.listMessages(workspaceId, conversationId, limit);
      res.json({ messages });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(conversationId)) {
        res.status(400).json({ error: 'workspaceId and conversationId must be valid UUIDs' });
        return;
      }

      const content = req.body?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      const result = await deps.conversationService.sendMessage({ workspaceId, conversationId, content });
      res.status(201).json(result);
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof ConversationNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}
