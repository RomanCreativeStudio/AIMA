import { Router, type Response } from 'express';
import { WorkspaceNotFoundError } from '../types/errors';
import { ConversationNotFoundError } from '../conversation/errors';
import { InvalidVoiceSessionStateError, VoiceSessionNotFoundError } from '../voice/errors';
import type { VoiceService } from '../voice/voiceService';
import { isUuid } from '../util/uuid';

export interface VoiceRouterDependencies {
  voiceService: VoiceService;
}

/**
 * The Voice Assistant Foundation's API (Phase 3.2, item 2): session
 * start/end/list/get, plus one dedicated route to submit a voice turn
 * (audio in, audio out) — no route here is ever invoked automatically, and
 * every session must be explicitly started/ended by the caller (item 5:
 * "user control required to start sessions"). Audio travels as base64 in a
 * JSON body, the same shape every other route in this API already uses —
 * never written to disk or logged (`backend/src/voice/voiceService.ts`).
 */
export function voiceRouter(deps: VoiceRouterDependencies): Router {
  const router = Router();

  router.post('/workspaces/:workspaceId/voice/sessions', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const session = await deps.voiceService.startSession(workspaceId);
      res.status(201).json({ session });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/voice/sessions/:voiceSessionId/end', async (req, res, next) => {
    try {
      const { workspaceId, voiceSessionId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(voiceSessionId)) {
        res.status(400).json({ error: 'workspaceId and voiceSessionId must be valid UUIDs' });
        return;
      }

      const session = await deps.voiceService.endSession(workspaceId, voiceSessionId);
      res.json({ session });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/voice/sessions', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const sessions = await deps.voiceService.listSessions(workspaceId);
      res.json({ sessions });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/voice/sessions/:voiceSessionId', async (req, res, next) => {
    try {
      const { workspaceId, voiceSessionId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(voiceSessionId)) {
        res.status(400).json({ error: 'workspaceId and voiceSessionId must be valid UUIDs' });
        return;
      }

      const session = await deps.voiceService.getSession(workspaceId, voiceSessionId);
      res.json({ session });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.get('/workspaces/:workspaceId/voice/sessions/:voiceSessionId/turns', async (req, res, next) => {
    try {
      const { workspaceId, voiceSessionId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(voiceSessionId)) {
        res.status(400).json({ error: 'workspaceId and voiceSessionId must be valid UUIDs' });
        return;
      }

      const turns = await deps.voiceService.listTurns(workspaceId, voiceSessionId);
      res.json({ turns });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/voice/sessions/:voiceSessionId/turns', async (req, res, next) => {
    try {
      const { workspaceId, voiceSessionId } = req.params;
      if (!isUuid(workspaceId) || !isUuid(voiceSessionId)) {
        res.status(400).json({ error: 'workspaceId and voiceSessionId must be valid UUIDs' });
        return;
      }

      const { audioBase64, audioMimeType, configuration } = req.body ?? {};
      if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
        res.status(400).json({ error: 'audioBase64 is required' });
        return;
      }
      if (typeof audioMimeType !== 'string' || audioMimeType.trim().length === 0) {
        res.status(400).json({ error: 'audioMimeType is required' });
        return;
      }

      const result = await deps.voiceService.submitVoiceRequest({
        workspaceId,
        voiceSessionId,
        audioData: Buffer.from(audioBase64, 'base64'),
        audioMimeType,
        configuration: configuration ?? undefined,
      });

      res.status(201).json({
        turn: result.turn,
        audioBase64: result.audio.data.toString('base64'),
        audioMimeType: result.audio.mimeType,
        intent: result.intent,
        approvalDecision: result.approvalDecision,
        workflowSuggestion: result.workflowSuggestion,
        executionSuggestion: result.executionSuggestion,
      });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof VoiceSessionNotFoundError || error instanceof ConversationNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidVoiceSessionStateError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
}
