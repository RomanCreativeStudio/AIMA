import 'dotenv/config';
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool } from './db/pool';
import { ActionLogger } from './actionLog/logger';
import { ConversationService } from './conversation/conversationService';
import { IntentEngine } from './intent/intentEngine';
import { MemoryService } from './memory/memoryService';
import { CapabilityRegistry } from './permissions/registry';
import { PermissionEngine } from './permissions/engine';
import { syncCapabilitiesToDatabase } from './permissions/syncCapabilities';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const registry = new CapabilityRegistry();

  // Gives the DB a stable row per capability (e.g. for pending_approvals'
  // capability_id foreign key) before any request can reach the ApprovalEngine.
  await syncCapabilitiesToDatabase(pool, registry);

  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(pool);
  const aiProvider = createAIProviderFromEnv();
  const embeddingProvider = createEmbeddingProviderFromEnv();
  const intentClassifier = new RuleBasedIntentClassifier();
  const intentEngine = new IntentEngine(intentClassifier, permissionEngine);
  const memoryService = new MemoryService(pool, embeddingProvider);
  const conversationService = new ConversationService(
    pool,
    memoryService,
    aiProvider,
    actionLogger,
    permissionEngine,
    intentEngine,
  );

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
}

main().catch((error) => {
  console.error('Failed to start AIMA backend:', error);
  process.exit(1);
});
