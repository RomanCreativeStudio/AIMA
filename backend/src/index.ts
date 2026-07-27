import 'dotenv/config';
import { createAIProviderFromEnv } from '@aima/ai-engine';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool } from './db/pool';
import { CapabilityRegistry } from './permissions/registry';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const registry = new CapabilityRegistry();
const aiProvider = createAIProviderFromEnv();

const app = createApp({
  pool,
  registry,
  aiProvider,
  corsOrigins: config.corsOrigins,
});

app.listen(config.port, () => {
  console.log(
    `AIMA backend listening on port ${config.port} (env: ${config.nodeEnv}, ai provider: ${aiProvider.name})`,
  );
});
