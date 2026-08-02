import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import type { AIProvider } from '@aima/ai-engine';
import type { AuthProvider } from './auth/types';
import type { SessionService } from './auth/sessionService';
import type { ActionLogger } from './actionLog/logger';
import type { ApprovalEngine } from './approval/approvalEngine';
import type { ConversationService } from './conversation/conversationService';
import type { RetrievalService } from './embeddings/retrievalService';
import type { DraftService } from './drafts/draftService';
import type { ExecutionService } from './execution/executionService';
import type { HealthService } from './health/healthService';
import type { BriefingService } from './insights/briefingService';
import type { ConversationIntelligenceService } from './insights/conversationIntelligenceService';
import type { TaskIntelligenceService } from './insights/taskIntelligenceService';
import type { WorkspaceInsightsService } from './insights/workspaceInsightsService';
import type { IntegrationService } from './integrations/integrationService';
import type { IntegrationRegistry } from './integrations/registry';
import type { OAuthService } from './oauth/oauthService';
import type { DocumentService } from './knowledge/documentService';
import type { MemoryService } from './memory/memoryService';
import type { ProactiveIntelligenceService } from './proactive/proactiveIntelligenceService';
import type { PreferenceService } from './preferences/preferenceService';
import type { TaskService } from './tasks/taskService';
import type { UserService } from './users/userService';
import type { WorkspaceService } from './workspaces/workspaceService';
import type { CapabilityRegistry } from './permissions/registry';
import type { PermissionEngine } from './permissions/engine';
import type { WorkflowRegistry } from './workflows/registry';
import type { WorkflowService } from './workflows/workflowService';
import type { VoiceService } from './voice/voiceService';
import type { NodeEnv } from './config/env';
import type { Logger } from './logging/types';
import { ConsoleLogger } from './logging/consoleLogger';
import type { ErrorReporter } from './monitoring/types';
import { ConsoleErrorReporter } from './monitoring/consoleErrorReporter';
import { requestLogger } from './middleware/requestLogger';
import { requireAuth } from './middleware/auth';
import { requireUserOwnership } from './middleware/userOwnership';
import { requireWorkspaceOwnership } from './middleware/workspaceOwnership';
import type { AuthRateLimiters } from './middleware/rateLimit';
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
import { oauthRouter, oauthCallbackRouter } from './routes/oauth';
import { authPublicRouter, authRouter } from './routes/auth';
import { preferencesRouter } from './routes/preferences';
import { proactiveRouter } from './routes/proactive';
import { retrievalRouter } from './routes/retrieval';
import { workflowsRouter } from './routes/workflows';
import { tasksRouter } from './routes/tasks';
import { usersRouter } from './routes/users';
import { workspacesRouter } from './routes/workspaces';
import { voiceRouter } from './routes/voice';
import { createErrorHandler } from './middleware/errorHandler';

export interface AppDependencies {
  pool: Pool;
  registry: CapabilityRegistry;
  /** REQ-001/ADR-0022 (EPIC-004 Sprint 4.5): the authentication gate every `/api` route (other than the OAuth callback) sits behind. Required, not optional — unlike `logger`/`errorReporter`, there is no safe default that keeps the app secure if a call site forgets to supply one. */
  authProvider: AuthProvider;
  permissionEngine: PermissionEngine;
  actionLogger: ActionLogger;
  memoryService: MemoryService;
  documentService: DocumentService;
  taskService: TaskService;
  draftService: DraftService;
  integrationService: IntegrationService;
  integrationRegistry: IntegrationRegistry;
  oauthService: OAuthService;
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
  voiceService: VoiceService;
  corsOrigins: string[];
  /** Phase 3.1: optional so every existing call site (tests included) keeps compiling — `createApp` builds a `ConsoleLogger`/`ConsoleErrorReporter` when these are omitted. */
  nodeEnv?: NodeEnv;
  logger?: Logger;
  errorReporter?: ErrorReporter;
  /** Phase 3.5: optional so every pre-existing call site keeps compiling — the `/proactive/*` routes are simply not mounted when this is omitted. */
  proactiveIntelligenceService?: ProactiveIntelligenceService;
  /** Phase 3.6: optional so every pre-existing call site keeps compiling — the `/retrieval/*` routes are simply not mounted when this is omitted. */
  retrievalService?: RetrievalService;
  /** EPIC-004 Sprint 4.6: optional so every pre-existing call site (tests included) keeps compiling — the `/api/auth/*` routes are simply not mounted when this is omitted. `index.ts`, the one real production call site, always supplies a real one. */
  sessionService?: SessionService;
  /** EPIC-004 Sprint 4.7 (ADR-0023): the public auth surface's rate limiters. Optional for the same reason `sessionService` is — but `authPublicRouter` only mounts when both are present (see below), so the login/refresh routes can never ship without their abuse protection. `index.ts` always supplies real ones, built by `authRateLimitConfigFromEnv`. */
  authRateLimiters?: AuthRateLimiters;
}

/**
 * Builds the Express app from injected dependencies rather than module-level
 * singletons, so it can be constructed in tests without a real database or
 * network-facing AI provider.
 */
export function createApp(deps: AppDependencies): Application {
  const app = express();
  const logger = deps.logger ?? new ConsoleLogger(deps.nodeEnv ?? 'development');
  const errorReporter = deps.errorReporter ?? new ConsoleErrorReporter(logger);

  // Trust the first proxy hop (ADR-0023) — ARCH-001 §8's recommended hosting
  // platforms (Fly.io/Render/Vercel) all terminate TLS at an edge proxy, so
  // without this, req.ip would resolve to that proxy's own address for
  // every request, making any per-IP rate limit effectively global instead
  // of per-caller.
  app.set('trust proxy', 1);

  app.use(helmet());
  // No CORS_ORIGINS configured => deny all cross-origin requests by default.
  app.use(cors({ origin: deps.corsOrigins.length > 0 ? deps.corsOrigins : false }));
  app.use(express.json());
  app.use(requestLogger(logger));

  app.use(healthRouter(deps.healthService));

  // OAuth's callback is hit by an external provider's browser redirect,
  // which carries no AIMA Authorization header — it must stay reachable
  // ahead of the authentication gate below (see backend/src/routes/oauth.ts
  // for why it can't require requireAuth or be workspace-scoped).
  app.use('/api', oauthCallbackRouter({ oauthService: deps.oauthService, actionLogger: deps.actionLogger }));

  // Login/refresh (EPIC-004 Sprint 4.6) must stay reachable ahead of the
  // authentication gate below — a caller cannot present a valid access
  // token to obtain one in the first place, or to refresh an expired one.
  // Rate limiters (EPIC-004 Sprint 4.7, ADR-0023, REQ-001 criterion 5) are
  // required alongside sessionService, not independently optional — the
  // public auth surface should never be mountable without its abuse
  // protection.
  if (deps.sessionService && deps.authRateLimiters) {
    app.use(
      '/api',
      authPublicRouter({
        authProvider: deps.authProvider,
        sessionService: deps.sessionService,
        userService: deps.userService,
        loginEmailRateLimiter: deps.authRateLimiters.loginEmail,
        loginIpRateLimiter: deps.authRateLimiters.loginIp,
        refreshIpRateLimiter: deps.authRateLimiters.refreshIp,
      }),
    );
  }

  // Authentication gate (ADR-0022 Decision 2/5, REQ-001, EPIC-004 Sprint
  // 4.5): every other /api route requires a verified caller identity.
  app.use('/api', requireAuth(deps.authProvider));
  // Account-boundary ownership checks — uniform 404 for "doesn't exist" vs
  // "belongs to someone else" (ADR-0022 Decision 5). Path-scoped so they
  // apply to every current and future route under these prefixes without
  // each router needing to know auth exists.
  app.use('/api/users/:userId', requireUserOwnership());
  app.use('/api/workspaces/:workspaceId', requireWorkspaceOwnership(deps.workspaceService));

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
      actionLogger: deps.actionLogger,
    }),
  );
  app.use('/api', oauthRouter({ oauthService: deps.oauthService }));
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
  app.use('/api', voiceRouter({ voiceService: deps.voiceService }));
  if (deps.proactiveIntelligenceService) {
    app.use('/api', proactiveRouter({ proactiveIntelligenceService: deps.proactiveIntelligenceService }));
  }
  if (deps.retrievalService) {
    app.use(
      '/api',
      retrievalRouter({
        retrievalService: deps.retrievalService,
        permissionEngine: deps.permissionEngine,
        actionLogger: deps.actionLogger,
      }),
    );
  }
  if (deps.sessionService) {
    app.use(
      '/api',
      authRouter({
        authProvider: deps.authProvider,
        sessionService: deps.sessionService,
        userService: deps.userService,
      }),
    );
  }

  app.use(createErrorHandler(errorReporter));

  return app;
}
