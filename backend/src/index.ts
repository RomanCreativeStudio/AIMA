import 'dotenv/config';
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv } from '@aima/ai-engine';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool } from './db/pool';
import { ActionLogger } from './actionLog/logger';
import { ConversationService } from './conversation/conversationService';
import { MemoryService } from './memory/memoryService';
import { CapabilityRegistry } from './permissions/registry';
import { PermissionEngine } from './permissions/engine';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const registry = new CapabilityRegistry();
const permissionEngine = new PermissionEngine(registry);
const actionLogger = new ActionLogger(pool);
const aiProvider = createAIProviderFromEnv();
const embeddingProvider = createEmbeddingProviderFromEnv();
const memoryService = new MemoryService(pool, embeddingProvider);
const conversationService = new ConversationService(pool, memoryService, aiProvider, actionLogger, permissionEngine);

const app = createApp({
  pool,
  registry,
  permissionEngine,
  actionLogger,
  memoryService,
  conversationService,
  aiProvider,
  corsOrigins: config.corsOrigins,
});

app.listen(config.port, () => {
  console.log(
    `AIMA backend listening on port ${config.port} ` +
      `(env: ${config.nodeEnv}, ai provider: ${aiProvider.name}, embedding provider: ${embeddingProvider.name})`,
  );
});
