import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import type { AIProvider } from '@aima/ai-engine';
import type { ActionLogger } from './actionLog/logger';
import type { ApprovalEngine } from './approval/approvalEngine';
import type { ConversationService } from './conversation/conversationService';
import type { DraftService } from './drafts/draftService';
import type { ExecutionService } from './execution/executionService';
import type { HealthService } from './health/healthService';
import type { BriefingService } from './insights/briefingService';
import type { ConversationIntelligenceService } from './insights/conversationIntelligenceService';
import type { TaskIntelligenceService } from './insights/taskIntelligenceService';
import type { WorkspaceInsightsService } from './insights/workspaceInsightsService';
import type { IntegrationService } from './integrations/integrationService';
import type { IntegrationRegistry } from './integrations/registry';
import type { DocumentService } from './knowledge/documentService';
import type { MemoryService } from './memory/memoryService';
import type { PreferenceService } from './preferences/preferenceService';
import type { TaskService } from './tasks/taskService';
import type { UserService } from './users/userService';
import type { WorkspaceService } from './workspaces/workspaceService';
import type { CapabilityRegistry } from './permissions/registry';
import type { PermissionEngine } from './permissions/engine';
import type { WorkflowRegistry } from './workflows/registry';
import type { WorkflowService } from './workflows/workflowService';
import { healthRouter } from './routes/health';
import { capabilitiesRouter } from './routes/capabilities';
import { aiRouter } from './routes/ai';
import { approvalsRouter } from './routes/approvals';
import { memoriesRouter } from './routes/memories';
import { conversationsRouter } from './routes/conversations';
import { documentsRouter } from './routes/documents';
import { draftsRouter } from './routes/drafts';
import { executionsRouter } from './routes/executions';
import { insightsRouter } from './routes/insights';
import { integrationsRouter } from './routes/integrations';
import { preferencesRouter } from './routes/preferences';
import { workflowsRouter } from './routes/workflows';
import { tasksRouter } from './routes/tasks';
import { usersRouter } from './routes/users';
import { workspacesRouter } from './routes/workspaces';
import { errorHandler } from './middleware/errorHandler';

export interface AppDependencies {
  pool: Pool;
  registry: CapabilityRegistry;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
  memoryService: MemoryService;
  documentService: DocumentService;
  taskService: TaskService;
  draftService: DraftService;
  integrationService: IntegrationService;
  integrationRegistry: IntegrationRegistry;
  workflowService: WorkflowService;
  workflowRegistry: WorkflowRegistry;
  preferenceService: PreferenceService;
  userService: UserService;
  workspaceService: WorkspaceService;
  approvalEngine: ApprovalEngine;
  healthService: HealthService;
  conversationService: ConversationService;
  aiProvider: AIProvider;
  briefingService: BriefingService;
  taskIntelligenceService: TaskIntelligenceService;
  conversationIntelligenceService: ConversationIntelligenceService;
  workspaceInsightsService: WorkspaceInsightsService;
  executionService: ExecutionService;
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

  app.use(healthRouter(deps.healthService));
  app.use('/api', capabilitiesRouter(deps.registry));
  app.use('/api', aiRouter(deps.aiProvider));
  app.use(
    '/api',
    memoriesRouter({
      memoryService: deps.memoryService,
      permissionEngine: deps.permissionEngine,
      actionLogger: deps.actionLogger,
    }),
  );
  app.use(
    '/api',
    documentsRouter({
      documentService: deps.documentService,
      permissionEngine: deps.permissionEngine,
      actionLogger: deps.actionLogger,
    }),
  );
  app.use(
    '/api',
    tasksRouter({
      taskService: deps.taskService,
      permissionEngine: deps.permissionEngine,
      actionLogger: deps.actionLogger,
    }),
  );
  app.use(
    '/api',
    draftsRouter({
      draftService: deps.draftService,
      permissionEngine: deps.permissionEngine,
      actionLogger: deps.actionLogger,
    }),
  );
  app.use(
    '/api',
    preferencesRouter({
      preferenceService: deps.preferenceService,
      permissionEngine: deps.permissionEngine,
      actionLogger: deps.actionLogger,
    }),
  );
  app.use(
    '/api',
    integrationsRouter({
      integrationService: deps.integrationService,
      integrationRegistry: deps.integrationRegistry,
      permissionEngine: deps.permissionEngine,
    }),
  );
  app.use(
    '/api',
    workflowsRouter({
      workflowService: deps.workflowService,
      workflowRegistry: deps.workflowRegistry,
    }),
  );
  app.use('/api', usersRouter({ userService: deps.userService }));
  app.use('/api', workspacesRouter({ workspaceService: deps.workspaceService }));
  app.use('/api', approvalsRouter({ approvalEngine: deps.approvalEngine }));
  app.use('/api', conversationsRouter({ conversationService: deps.conversationService }));
  app.use(
    '/api',
    insightsRouter({
      briefingService: deps.briefingService,
      taskIntelligenceService: deps.taskIntelligenceService,
      conversationIntelligenceService: deps.conversationIntelligenceService,
      workspaceInsightsService: deps.workspaceInsightsService,
    }),
  );
  app.use('/api', executionsRouter({ executionService: deps.executionService }));

  app.use(errorHandler);

  return app;
}
