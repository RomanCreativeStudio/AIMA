import { Router } from 'express';
import type { Pool } from 'pg';

export function healthRouter(pool: Pool): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let database: 'ok' | 'error' = 'error';
    try {
      await pool.query('SELECT 1');
      database = 'ok';
    } catch {
      database = 'error';
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database,
    });
  });

  return router;
}
