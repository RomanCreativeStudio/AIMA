import { Router } from 'express';
import type { CapabilityRegistry } from '../permissions/registry';

/** Read-only view into the permission architecture (docs/TECHNICAL_ARCHITECTURE.md §5). */
export function capabilitiesRouter(registry: CapabilityRegistry): Router {
  const router = Router();

  router.get('/capabilities', (_req, res) => {
    res.json({ capabilities: registry.list() });
  });

  return router;
}
