import { Router, type Response } from 'express';
import type { ActionLogger } from '../actionLog/logger';
import { WorkspaceNotFoundError } from '../types/errors';
import {
  IntegrationConnectionFailedError,
  IntegrationNotFoundError,
  InvalidCredentialsError,
} from '../integrations/errors';
import type { IntegrationRegistry } from '../integrations/registry';
import { isIntegrationProvider, type IntegrationProvider, type WorkspaceIntegration } from '../integrations/types';
import type { IntegrationService } from '../integrations/integrationService';
import type { PermissionEngine } from '../permissions/engine';
import { isUuid } from '../util/uuid';

export interface IntegrationsRouterDependencies {
  integrationService: IntegrationService;
  integrationRegistry: IntegrationRegistry;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
}

/**
 * Connecting, rotating, or disconnecting an integration establishes or
 * removes AIMA's access to a real external account — a security-relevant
 * event `IntegrationService` itself never logged (EPIC-007 Sprint 7.1
 * audit finding: the only trace previously left behind was the current,
 * mutable `workspace_integrations` row, overwritten on every reconnect).
 * No dedicated capability is registered for this — connect/disconnect are
 * infrastructure/setup operations, the same "ungated but still logged"
 * treatment `conversationService.ts` gives `generate_ai_response` (Tier 1,
 * logged without requiring approval) — so this logs a plain `'prepare'`
 * tier entry rather than inventing a new gated capability for what remains
 * a deliberately ungated action.
 */
const INTEGRATION_LOG_TIER = 'prepare' as const;

/** What the Integrations screen (Phase 2.3, item 5) actually needs to render one provider's card: status, its capability display, and which credential fields a connect/rotate form should collect. */
interface IntegrationSummary extends WorkspaceIntegration {
  displayName: string;
  description: string;
  capabilities: Array<{ actionType: string; tier: string }>;
  requiredCredentialFields: string[];
}

/**
 * The External Integrations Foundation's API (Phase 2.3): connect/
 * disconnect/rotate a workspace's connection to a fixed provider, and list
 * every provider's status. Deliberately no route to actually read data
 * through a connector — this phase ships the framework and credential
 * layer only, per its "no automation execution" scope
 * (docs/decisions/0011-external-integrations-foundation.md). Credentials
 * are accepted here and handed straight to `IntegrationService`, which
 * encrypts them before they ever touch the database — this router never
 * reads or returns decrypted credential material.
 */
export function integrationsRouter(deps: IntegrationsRouterDependencies): Router {
  const router = Router();

  router.get('/workspaces/:workspaceId/integrations', async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      if (!isUuid(workspaceId)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID' });
        return;
      }

      const integrations = await deps.integrationService.listForWorkspace(workspaceId);
      res.json({ integrations: integrations.map((integration) => summarize(integration, deps)) });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/integrations/:provider/connect', async (req, res, next) => {
    try {
      const { workspaceId, provider } = req.params;
      if (!isUuid(workspaceId) || !isIntegrationProvider(provider)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID and provider must be a known integration' });
        return;
      }

      const credentials = req.body?.credentials;
      if (!isCredentialsRecord(credentials)) {
        res.status(400).json({ error: 'credentials must be an object of string fields' });
        return;
      }

      let integration;
      try {
        integration = await deps.integrationService.connect({ workspaceId, provider, credentials });
      } catch (error) {
        if (error instanceof IntegrationConnectionFailedError || error instanceof InvalidCredentialsError) {
          await deps.actionLogger.log({
            workspaceId,
            tier: INTEGRATION_LOG_TIER,
            summary: `Failed to connect ${provider}`,
            payload: { provider, error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: INTEGRATION_LOG_TIER,
        summary: `Connected ${provider}`,
        payload: { provider },
        outcome: 'success',
      });

      res.status(200).json({ integration: summarize(integration, deps) });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/integrations/:provider/disconnect', async (req, res, next) => {
    try {
      const { workspaceId, provider } = req.params;
      if (!isUuid(workspaceId) || !isIntegrationProvider(provider)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID and provider must be a known integration' });
        return;
      }

      const integration = await deps.integrationService.disconnect(workspaceId, provider);

      await deps.actionLogger.log({
        workspaceId,
        tier: INTEGRATION_LOG_TIER,
        summary: `Disconnected ${provider}`,
        payload: { provider },
        outcome: 'success',
      });

      res.status(200).json({ integration: summarize(integration, deps) });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  router.post('/workspaces/:workspaceId/integrations/:provider/rotate', async (req, res, next) => {
    try {
      const { workspaceId, provider } = req.params;
      if (!isUuid(workspaceId) || !isIntegrationProvider(provider)) {
        res.status(400).json({ error: 'workspaceId must be a valid UUID and provider must be a known integration' });
        return;
      }

      const credentials = req.body?.credentials;
      if (!isCredentialsRecord(credentials)) {
        res.status(400).json({ error: 'credentials must be an object of string fields' });
        return;
      }

      let integration;
      try {
        integration = await deps.integrationService.rotate({ workspaceId, provider, credentials });
      } catch (error) {
        if (error instanceof IntegrationConnectionFailedError || error instanceof InvalidCredentialsError) {
          await deps.actionLogger.log({
            workspaceId,
            tier: INTEGRATION_LOG_TIER,
            summary: `Failed to rotate ${provider} credentials`,
            payload: { provider, error: (error as Error).message },
            outcome: 'failure',
          });
        }
        throw error;
      }

      await deps.actionLogger.log({
        workspaceId,
        tier: INTEGRATION_LOG_TIER,
        summary: `Rotated ${provider} credentials`,
        payload: { provider },
        outcome: 'success',
      });

      res.status(200).json({ integration: summarize(integration, deps) });
    } catch (error) {
      handleKnownErrors(error, res, next);
    }
  });

  return router;
}

function summarize(integration: WorkspaceIntegration, deps: IntegrationsRouterDependencies): IntegrationSummary {
  const definition = deps.integrationRegistry.get(integration.provider);
  if (!definition) {
    throw new Error(`Unregistered integration provider: "${integration.provider}"`);
  }

  const capabilityActionTypes = [definition.readCapability, ...definition.writeCapabilities];

  return {
    ...integration,
    displayName: definition.displayName,
    description: definition.description,
    capabilities: capabilityActionTypes.map((actionType) => ({
      actionType,
      tier: deps.permissionEngine.resolveTier(actionType),
    })),
    requiredCredentialFields: definition.requiredCredentialFields,
  };
}

function isCredentialsRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((field) => typeof field === 'string');
}

function handleKnownErrors(error: unknown, res: Response, next: (error: unknown) => void): void {
  if (error instanceof WorkspaceNotFoundError || error instanceof IntegrationNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidCredentialsError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof IntegrationConnectionFailedError) {
    res.status(422).json({ error: error.message });
    return;
  }
  next(error);
}
