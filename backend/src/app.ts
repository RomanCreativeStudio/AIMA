import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import type { AIProvider } from '@aima/ai-engine';
import type { CapabilityRegistry } from './permissions/registry';
import { healthRouter } from './routes/health';
import { capabilitiesRouter } from './routes/capabilities';
import { aiRouter } from './routes/ai';
import { errorHandler } from './middleware/errorHandler';

export interface AppDependencies {
  pool: Pool;
  registry: CapabilityRegistry;
  aiProvider: AIProvider;
  corsOrigins: string[];
}

/**
 * Builds the Express app from injected dependencies rather than module-level
 * singletons, so it can be constructed in tests without a real database or
 * network-facing AI provider.
 */
export function createApp(deps: AppDependencies): Application {
  const app = express();

  app.use(helmet());
  // No CORS_ORIGINS configured => deny all cross-origin requests by default.
  app.use(cors({ origin: deps.corsOrigins.length > 0 ? deps.corsOrigins : false }));
  app.use(express.json());

  app.use(healthRouter(deps.pool));
  app.use('/api', capabilitiesRouter(deps.registry));
  app.use('/api', aiRouter(deps.aiProvider));

  app.use(errorHandler);

  return app;
}
