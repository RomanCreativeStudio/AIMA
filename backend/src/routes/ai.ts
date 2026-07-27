import { Router } from 'express';
import type { AIMessage, AIProvider } from '@aima/ai-engine';

/**
 * Foundation-stage smoke-test endpoint that proves the backend can reach an
 * AIProvider through the ai-engine abstraction. This is NOT the final chat
 * pipeline: it bypasses context assembly, memory retrieval, and the
 * permission engine, all of which land in the Intelligence and Integration
 * Sprints (docs/TECHNICAL_ARCHITECTURE.md §4, §10).
 */
export function aiRouter(provider: AIProvider): Router {
  const router = Router();

  router.post('/ai/complete', async (req, res, next) => {
    try {
      const messages = req.body?.messages as AIMessage[] | undefined;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Request body must include a non-empty "messages" array.' });
        return;
      }

      const result = await provider.complete({ messages });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
