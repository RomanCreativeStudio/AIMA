import { Router } from 'express';
import type { HealthService } from '../health/healthService';

export function healthRouter(healthService: HealthService): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const health = await healthService.check();

    res.json({
      status: health.status,
      timestamp: new Date().toISOString(),
      checks: health.checks,
    });
  });

  return router;
}
