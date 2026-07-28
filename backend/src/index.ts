import 'dotenv/config';
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv, RuleBasedIntentClassifier } from '@aima/ai-engine';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool } from './db/pool';
import { ActionLogger } from './actionLog/logger';
import { ApprovalEngine } from './approval/approvalEngine';
import { AimaCoreService } from './core/aimaCoreService';
import { ContextManager } from './core/contextManager';
import { ConversationService } from './conversation/conversationService';
import { DraftService } from './drafts/draftService';
import { HealthService } from './health/healthService';
import { BriefingService } from './insights/briefingService';
import { ConversationIntelligenceService } from './insights/conversationIntelligenceService';
import { TaskIntelligenceService } from './insights/taskIntelligenceService';
import { WorkspaceInsightsService } from './insights/workspaceInsightsService';
import { IntentEngine } from './intent/intentEngine';
import { StubCalendarConnector } from './integrations/connectors/calendarConnector';
import { StubGitHubConnector } from './integrations/connectors/githubConnector';
import { StubGmailConnector } from './integrations/connectors/gmailConnector';
import type { IntegrationConnector } from './integrations/connectors/types';
import { AesGcmCredentialEncryptor } from './integrations/encryption';
import { IntegrationService } from './integrations/integrationService';
import { IntegrationRegistry } from './integrations/registry';
import type { IntegrationProvider } from './integrations/types';
import { DocumentService } from './knowledge/documentService';
import { MemoryService } from './memory/memoryService';
import { PreferenceService } from './preferences/preferenceService';
import { CapabilityRegistry } from './permissions/registry';
import { PermissionEngine } from './permissions/engine';
import { syncCapabilitiesToDatabase } from './permissions/syncCapabilities';
import { TaskService } from './tasks/taskService';
import { UserService } from './users/userService';
import { WorkspaceService } from './workspaces/workspaceService';
import { CreateGithubIssueDraftWorkflowHandler } from './workflows/handlers/createGithubIssueDraftWorkflow';
import { DailyWorkspaceBriefingWorkflowHandler } from './workflows/handlers/dailyWorkspaceBriefingWorkflow';
import { DraftEmailReplyWorkflowHandler } from './workflows/handlers/draftEmailReplyWorkflow';
import { SummarizeUnreadEmailWorkflowHandler } from './workflows/handlers/summarizeUnreadEmailWorkflow';
import type { WorkflowHandler } from './workflows/handlers/types';
import { WorkflowRegistry } from './workflows/registry';
import type { WorkflowKey } from './workflows/types';
import { WorkflowIntentMatcher } from './workflows/workflowIntentMatcher';
import { WorkflowService } from './workflows/workflowService';

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
  const approvalEngine = new ApprovalEngine(pool, permissionEngine);
  const memoryService = new MemoryService(pool, embeddingProvider);
  const documentService = new DocumentService(pool, embeddingProvider);
  const preferenceService = new PreferenceService(pool);
  const taskService = new TaskService(pool);
  const draftService = new DraftService(pool);
  const integrationRegistry = new IntegrationRegistry();
  const credentialEncryptor = new AesGcmCredentialEncryptor(config.credentialEncryptionKey);
  const gmailConnector = new StubGmailConnector();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: gmailConnector,
    github: new StubGitHubConnector(),
    calendar: new StubCalendarConnector(),
  };
  const integrationService = new IntegrationService(pool, integrationRegistry, connectors, credentialEncryptor);
  const userService = new UserService(pool);
  const workspaceService = new WorkspaceService(pool);
  const healthService = new HealthService(pool, aiProvider);
  const contextManager = new ContextManager(memoryService, documentService, preferenceService);
  const aimaCoreService = new AimaCoreService(contextManager, aiProvider, intentEngine, approvalEngine, workspaceService);

  const workflowRegistry = new WorkflowRegistry();
  const getWorkflowDefinition = (key: WorkflowKey) => {
    const definition = workflowRegistry.get(key);
    if (!definition) {
      throw new Error(`Unregistered workflow: "${key}"`);
    }
    return definition;
  };
  const workflowHandlers: Record<WorkflowKey, WorkflowHandler> = {
    draft_email_reply: new DraftEmailReplyWorkflowHandler(
      getWorkflowDefinition('draft_email_reply'),
      aiProvider,
      draftService,
    ),
    create_github_issue_draft: new CreateGithubIssueDraftWorkflowHandler(
      getWorkflowDefinition('create_github_issue_draft'),
      aiProvider,
      draftService,
    ),
    summarize_unread_email: new SummarizeUnreadEmailWorkflowHandler(
      getWorkflowDefinition('summarize_unread_email'),
      aiProvider,
      integrationService,
      gmailConnector,
    ),
    daily_workspace_briefing: new DailyWorkspaceBriefingWorkflowHandler(
      getWorkflowDefinition('daily_workspace_briefing'),
      aiProvider,
      taskService,
      approvalEngine,
      healthService,
    ),
  };
  const workflowService = new WorkflowService(pool, workflowRegistry, workflowHandlers, approvalEngine);
  const workflowIntentMatcher = new WorkflowIntentMatcher(workflowRegistry);

  const conversationService = new ConversationService({
    db: pool,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
  });

  const briefingService = new BriefingService(workspaceService, taskService, approvalEngine, workflowService, actionLogger);
  const taskIntelligenceService = new TaskIntelligenceService(taskService);
  const conversationIntelligenceService = new ConversationIntelligenceService(conversationService, memoryService, aiProvider);
  const workspaceInsightsService = new WorkspaceInsightsService(
    workspaceService,
    actionLogger,
    workflowService,
    approvalEngine,
    taskService,
  );

  const app = createApp({
    pool,
    registry,
    permissionEngine,
    actionLogger,
    memoryService,
    documentService,
    taskService,
    draftService,
    integrationService,
    integrationRegistry,
    workflowService,
    workflowRegistry,
    approvalEngine,
    preferenceService,
    userService,
    workspaceService,
    healthService,
    conversationService,
    aiProvider,
    briefingService,
    taskIntelligenceService,
    conversationIntelligenceService,
    workspaceInsightsService,
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
