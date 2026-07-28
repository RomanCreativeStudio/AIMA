import { Router, type Response } from 'express';
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
}

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

      const integration = await deps.integrationService.connect({ workspaceId, provider, credentials });
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

      const integration = await deps.integrationService.rotate({ workspaceId, provider, credentials });
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
