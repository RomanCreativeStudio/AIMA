import 'dotenv/config';
import {
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  createSpeechToTextProviderFromEnv,
  createTextToSpeechProviderFromEnv,
  RuleBasedIntentClassifier,
} from '@aima/ai-engine';
import { createApp } from './app';
import { createAuthProviderFromEnv } from './auth/registry';
import { SessionService } from './auth/sessionService';
import { authRateLimitConfigFromEnv, RateLimiter, type AuthRateLimiters } from './middleware/rateLimit';
import { loadConfig } from './config/env';
import { createPool } from './db/pool';
import { ActionLogger } from './actionLog/logger';
import { ApprovalEngine } from './approval/approvalEngine';
import { AimaCoreService } from './core/aimaCoreService';
import { ContextManager } from './core/contextManager';
import { ConversationService } from './conversation/conversationService';
import { DraftService } from './drafts/draftService';
import { ExecutionIntentMatcher } from './execution/executionIntentMatcher';
import { ExecutionRegistry } from './execution/registry';
import { ExecutionService } from './execution/executionService';
import { CalendarCreateEventExecutor } from './execution/executors/calendarCreateEventExecutor';
import { CalendarUpdateEventExecutor } from './execution/executors/calendarUpdateEventExecutor';
import { CalendarDeleteEventExecutor } from './execution/executors/calendarDeleteEventExecutor';
import { GmailSaveDraftExecutor } from './execution/executors/gmailSaveDraftExecutor';
import { GmailSendEmailExecutor } from './execution/executors/gmailSendEmailExecutor';
import { GitHubCreateIssueExecutor } from './execution/executors/githubCreateIssueExecutor';
import { GitHubCreatePullRequestExecutor } from './execution/executors/githubCreatePullRequestExecutor';
import { HealthService, type IntegrationReadiness } from './health/healthService';
import { BriefingService } from './insights/briefingService';
import { ConversationIntelligenceService } from './insights/conversationIntelligenceService';
import { TaskIntelligenceService } from './insights/taskIntelligenceService';
import { WorkspaceInsightsService } from './insights/workspaceInsightsService';
import { IntentEngine } from './intent/intentEngine';
import { PatternDetectionService } from './proactive/patternDetectionService';
import { ProactiveIntelligenceService } from './proactive/proactiveIntelligenceService';
import { ConsoleLogger } from './logging/consoleLogger';
import { ConsoleErrorReporter } from './monitoring/consoleErrorReporter';
import { GoogleCalendarConnector } from './integrations/connectors/googleCalendarConnector';
import { LiveGitHubConnector } from './integrations/connectors/liveGitHubConnector';
import { GoogleGmailConnector } from './integrations/connectors/googleGmailConnector';
import type { IntegrationConnector } from './integrations/connectors/types';
import { AesGcmCredentialEncryptor } from './integrations/encryption';
import { IntegrationService } from './integrations/integrationService';
import { IntegrationRegistry } from './integrations/registry';
import type { IntegrationProvider } from './integrations/types';
import { DocumentService } from './knowledge/documentService';
import { EmbeddingService } from './embeddings/embeddingService';
import { RetrievalService } from './embeddings/retrievalService';
import { MemoryService } from './memory/memoryService';
import { GitHubOAuthProvider } from './oauth/githubOAuthProvider';
import { GOOGLE_OAUTH_SCOPES, GoogleOAuthProvider } from './oauth/googleOAuthProvider';
import { OAuthService } from './oauth/oauthService';
import type { OAuthProvider } from './oauth/types';
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
import { VoiceService } from './voice/voiceService';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger(config.nodeEnv);
  const errorReporter = new ConsoleErrorReporter(logger);
  const pool = createPool(config.databaseUrl, { ssl: config.databaseSsl, maxConnections: config.databasePoolMax });
  const registry = new CapabilityRegistry();

  // Gives the DB a stable row per capability (e.g. for pending_approvals'
  // capability_id foreign key) before any request can reach the ApprovalEngine.
  await syncCapabilitiesToDatabase(pool, registry);

  const permissionEngine = new PermissionEngine(registry);
  const actionLogger = new ActionLogger(pool);
  const authProvider = createAuthProviderFromEnv();
  const aiProvider = createAIProviderFromEnv();
  const embeddingProvider = createEmbeddingProviderFromEnv();
  const speechToTextProvider = createSpeechToTextProviderFromEnv();
  const textToSpeechProvider = createTextToSpeechProviderFromEnv();
  const intentClassifier = new RuleBasedIntentClassifier();
  const intentEngine = new IntentEngine(intentClassifier, permissionEngine);
  const approvalEngine = new ApprovalEngine(pool, permissionEngine);
  const memoryService = new MemoryService(pool, embeddingProvider);
  const documentService = new DocumentService(pool, embeddingProvider);
  const embeddingService = new EmbeddingService(pool, embeddingProvider);
  const retrievalService = new RetrievalService(pool, embeddingProvider, embeddingService, memoryService);
  const preferenceService = new PreferenceService(pool);
  const taskService = new TaskService(pool);
  const draftService = new DraftService(pool);
  const integrationRegistry = new IntegrationRegistry();
  const credentialEncryptor = new AesGcmCredentialEncryptor(config.credentialEncryptionKey);
  const gmailConnector = new GoogleGmailConnector();
  const githubConnector = new LiveGitHubConnector();
  const calendarConnector = new GoogleCalendarConnector();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: gmailConnector,
    github: githubConnector,
    calendar: calendarConnector,
  };

  // One Google OAuth app covers both `gmail` and `calendar` — same client
  // id/secret, different scopes and (necessarily) different redirect_uris,
  // since Google's authorization server routes strictly by redirect_uri.
  const oauthProviders: Partial<Record<IntegrationProvider, OAuthProvider>> = {
    gmail: new GoogleOAuthProvider(
      'gmail',
      config.googleOAuthClientId,
      config.googleOAuthClientSecret,
      `${config.publicBackendUrl}/api/oauth/gmail/callback`,
      GOOGLE_OAUTH_SCOPES.gmail,
    ),
    calendar: new GoogleOAuthProvider(
      'calendar',
      config.googleOAuthClientId,
      config.googleOAuthClientSecret,
      `${config.publicBackendUrl}/api/oauth/calendar/callback`,
      GOOGLE_OAUTH_SCOPES.calendar,
    ),
    github: new GitHubOAuthProvider(
      config.githubOAuthClientId,
      config.githubOAuthClientSecret,
      `${config.publicBackendUrl}/api/oauth/github/callback`,
    ),
  };

  const integrationService = new IntegrationService(pool, integrationRegistry, connectors, credentialEncryptor, oauthProviders);
  const oauthService = new OAuthService(pool, oauthProviders, integrationService);
  const userService = new UserService(pool);
  const workspaceService = new WorkspaceService(pool);
  const sessionService = new SessionService(pool, authProvider);
  const rateLimitConfig = authRateLimitConfigFromEnv();
  const authRateLimiters: AuthRateLimiters = {
    loginEmail: new RateLimiter(rateLimitConfig.loginByEmail),
    loginIp: new RateLimiter(rateLimitConfig.loginByIp),
    refreshIp: new RateLimiter(rateLimitConfig.refreshByIp),
  };
  const integrationReadiness: IntegrationReadiness = {
    gmail: Boolean(oauthProviders.gmail),
    github: Boolean(oauthProviders.github),
    calendar: Boolean(oauthProviders.calendar),
  };
  const healthService = new HealthService(pool, aiProvider, integrationReadiness, {
    speechToText: speechToTextProvider.name,
    textToSpeech: textToSpeechProvider.name,
  });
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

  const executionRegistry = new ExecutionRegistry([
    new GmailSendEmailExecutor(gmailConnector),
    new GmailSaveDraftExecutor(gmailConnector),
    new GitHubCreateIssueExecutor(githubConnector),
    new GitHubCreatePullRequestExecutor(githubConnector),
    new CalendarCreateEventExecutor(calendarConnector),
    new CalendarUpdateEventExecutor(calendarConnector),
    new CalendarDeleteEventExecutor(calendarConnector),
  ]);
  const executionService = new ExecutionService(pool, executionRegistry, integrationService, approvalEngine, permissionEngine);
  const executionIntentMatcher = new ExecutionIntentMatcher(executionRegistry);

  const conversationService = new ConversationService({
    db: pool,
    aimaCoreService,
    actionLogger,
    permissionEngine,
    workflowIntentMatcher,
    executionIntentMatcher,
    retrievalService,
  });

  const voiceService = new VoiceService(pool, conversationService, speechToTextProvider, textToSpeechProvider);

  const patternDetectionService = new PatternDetectionService(
    workspaceService,
    taskService,
    workflowService,
    approvalEngine,
    actionLogger,
    memoryService,
  );
  const proactiveIntelligenceService = new ProactiveIntelligenceService(
    patternDetectionService,
    memoryService,
    integrationService,
    integrationRegistry,
  );
  const briefingService = new BriefingService(
    workspaceService,
    taskService,
    approvalEngine,
    workflowService,
    actionLogger,
    memoryService,
    proactiveIntelligenceService,
  );
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
    authProvider,
    permissionEngine,
    actionLogger,
    memoryService,
    documentService,
    taskService,
    draftService,
    integrationService,
    integrationRegistry,
    oauthService,
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
    proactiveIntelligenceService,
    executionService,
    voiceService,
    retrievalService,
    sessionService,
    authRateLimiters,
    corsOrigins: config.corsOrigins,
    nodeEnv: config.nodeEnv,
    logger,
    errorReporter,
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
