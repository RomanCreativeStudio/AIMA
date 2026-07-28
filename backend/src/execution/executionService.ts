import type { ApprovalEngine } from '../approval/approvalEngine';
import type { Queryable } from '../db/queryable';
import type { IntegrationCredentials, IntegrationProvider } from '../integrations/types';
import type { IntegrationService } from '../integrations/integrationService';
import type { PermissionEngine } from '../permissions/engine';
import { WorkspaceNotFoundError } from '../types/errors';
import { IntegrationNotFoundError } from '../integrations/errors';
import { ExecutionApprovalNotYetGrantedError, ExecutionNotFoundError, ExecutorNotFoundError } from './errors';
import type { ExecutionRegistry } from './registry';
import {
  TERMINAL_EXECUTION_STATUSES,
  type CreateExecutionRequestInput,
  type ExecutionPreview,
  type ExecutionRecord,
  type ExecutionRequestPayload,
  type ExecutionStatus,
} from './types';

/**
 * The Action Execution Foundation's orchestrator (Phase 2.6, item 1): built
 * entirely on the existing capability/approval/integration machinery,
 * mirroring `WorkflowService`'s split between "create a request" and "run
 * it" — `execute()` performs at most one action per call, is idempotent on
 * a terminal record (a retry never re-contacts the provider), and always
 * re-checks approval fresh via `ApprovalEngine.get`, never trusting the
 * state captured at creation time (docs/decisions/0014-action-execution-
 * foundation.md).
 */
export class ExecutionService {
  constructor(
    private readonly db: Queryable,
    private readonly executionRegistry: ExecutionRegistry,
    private readonly integrationService: IntegrationService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly permissionEngine: PermissionEngine,
  ) {}

  /**
   * Pure, read-only — never persists anything (item 5: "Generate an
   * execution preview"). `tokenExpiresAt` is live provider metadata added
   * in Phase 2.7 (item 7: "Allow conversation previews to include live
   * provider metadata"): now that providers are real OAuth-connected
   * accounts rather than deterministic stubs, a caller deciding whether to
   * confirm an execution can see whether the underlying connection's token
   * is already expired or about to be — still without ever contacting the
   * provider or executing anything.
   */
  async preview(workspaceId: string, actionType: string, payload: ExecutionRequestPayload): Promise<ExecutionPreview> {
    await this.assertWorkspaceExists(workspaceId);
    const executor = this.getExecutor(actionType);
    const tier = this.permissionEngine.resolveTier(actionType);
    const { connected: integrationConnected, tokenExpiresAt } = await this.getIntegrationStatus(workspaceId, executor.provider);

    return {
      actionType,
      provider: executor.provider,
      tier,
      requiresApproval: tier === 'execute_with_approval',
      integrationConnected,
      tokenExpiresAt,
      payload,
    };
  }

  /**
   * Creates a persisted execution request and evaluates approval — never
   * contacts the provider. Rejects before even creating an approval if the
   * integration isn't connected (item 3: "Reject unauthorized execution
   * before contacting providers").
   */
  async createExecutionRequest(input: CreateExecutionRequestInput): Promise<ExecutionRecord> {
    await this.assertWorkspaceExists(input.workspaceId);
    const executor = this.getExecutor(input.actionType);

    const integrationConnected = await this.isIntegrationConnected(input.workspaceId, executor.provider);
    if (!integrationConnected) {
      throw new IntegrationNotFoundError(input.workspaceId, executor.provider);
    }

    const decision = await this.approvalEngine.evaluate(input.workspaceId, input.actionType, input.payload);
    const status: ExecutionStatus = decision.state === 'pending' ? 'awaiting_approval' : 'pending';
    const pendingApprovalId = decision.state === 'pending' ? (decision.pendingApprovalId ?? null) : null;

    const result = await this.db.query<ExecutionRow>(
      `INSERT INTO executions (workspace_id, provider, action_type, status, request_payload, pending_approval_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, workspace_id, provider, action_type, status, request_payload, response_summary, error_details,
                 pending_approval_id, started_at, completed_at, created_at, updated_at`,
      [input.workspaceId, executor.provider, input.actionType, status, JSON.stringify(input.payload), pendingApprovalId],
    );

    return mapExecutionRow(result.rows[0]);
  }

  /**
   * Advances an execution by at most one attempt (mirrors `WorkflowService.
   * executeNextStep`'s "one step per call" rule). Idempotent on a terminal
   * record: calling this again after success/failure just returns the
   * stored result, no provider re-contact (item 1: "Idempotent where
   * practical"; item 9: idempotent retry coverage).
   */
  async execute(workspaceId: string, executionId: string): Promise<ExecutionRecord> {
    const execution = await this.getExecution(workspaceId, executionId);
    if (TERMINAL_EXECUTION_STATUSES.includes(execution.status)) {
      return execution;
    }

    if (execution.status === 'awaiting_approval') {
      const approval = await this.approvalEngine.get(workspaceId, execution.pendingApprovalId!);
      if (approval.status === 'pending') {
        throw new ExecutionApprovalNotYetGrantedError(executionId);
      }
      if (approval.status !== 'approved') {
        return this.finish(execution, 'failed', {
          responseSummary: null,
          errorDetails: `Approval was ${approval.status}`,
        });
      }
    }

    return this.runExecutor(workspaceId, execution);
  }

  async listHistory(workspaceId: string): Promise<ExecutionRecord[]> {
    await this.assertWorkspaceExists(workspaceId);
    const result = await this.db.query<ExecutionRow>(
      `SELECT id, workspace_id, provider, action_type, status, request_payload, response_summary, error_details,
              pending_approval_id, started_at, completed_at, created_at, updated_at
       FROM executions WHERE workspace_id = $1 ORDER BY sequence DESC`,
      [workspaceId],
    );
    return result.rows.map(mapExecutionRow);
  }

  async getExecution(workspaceId: string, executionId: string): Promise<ExecutionRecord> {
    const result = await this.db.query<ExecutionRow>(
      `SELECT id, workspace_id, provider, action_type, status, request_payload, response_summary, error_details,
              pending_approval_id, started_at, completed_at, created_at, updated_at
       FROM executions WHERE id = $1 AND workspace_id = $2`,
      [executionId, workspaceId],
    );
    if (result.rows.length === 0) {
      throw new ExecutionNotFoundError(executionId, workspaceId);
    }
    return mapExecutionRow(result.rows[0]);
  }

  private async runExecutor(workspaceId: string, execution: ExecutionRecord): Promise<ExecutionRecord> {
    const executor = this.getExecutor(execution.actionType);
    const startedAt = new Date();

    let credentials: IntegrationCredentials;
    try {
      credentials = await this.integrationService.getDecryptedCredentials(workspaceId, executor.provider);
    } catch (error) {
      return this.finish(execution, 'failed', {
        responseSummary: null,
        errorDetails: `Integration not connected: ${(error as Error).message}`,
        startedAt,
      });
    }

    try {
      const outcome = await executor.execute({ workspaceId, payload: execution.requestPayload, credentials });
      return this.finish(execution, 'succeeded', { responseSummary: outcome.responseSummary, errorDetails: null, startedAt });
    } catch (error) {
      return this.finish(execution, 'failed', {
        responseSummary: null,
        errorDetails: (error as Error).message,
        startedAt,
      });
    }
  }

  private async finish(
    execution: ExecutionRecord,
    status: 'succeeded' | 'failed',
    outcome: { responseSummary: Record<string, unknown> | null; errorDetails: string | null; startedAt?: Date },
  ): Promise<ExecutionRecord> {
    const startedAt = outcome.startedAt ?? (execution.startedAt ? new Date(execution.startedAt) : new Date());
    const completedAt = new Date();

    const result = await this.db.query<ExecutionRow>(
      `UPDATE executions
       SET status = $1, response_summary = $2::jsonb, error_details = $3, started_at = $4, completed_at = $5, updated_at = now()
       WHERE id = $6
       RETURNING id, workspace_id, provider, action_type, status, request_payload, response_summary, error_details,
                 pending_approval_id, started_at, completed_at, created_at, updated_at`,
      [
        status,
        outcome.responseSummary !== null ? JSON.stringify(outcome.responseSummary) : null,
        outcome.errorDetails,
        startedAt,
        completedAt,
        execution.id,
      ],
    );
    return mapExecutionRow(result.rows[0]);
  }

  private getExecutor(actionType: string) {
    const executor = this.executionRegistry.get(actionType);
    if (!executor) {
      throw new ExecutorNotFoundError(actionType);
    }
    return executor;
  }

  private async isIntegrationConnected(workspaceId: string, provider: IntegrationProvider): Promise<boolean> {
    return (await this.getIntegrationStatus(workspaceId, provider)).connected;
  }

  private async getIntegrationStatus(
    workspaceId: string,
    provider: IntegrationProvider,
  ): Promise<{ connected: boolean; tokenExpiresAt: string | null }> {
    const integrations = await this.integrationService.listForWorkspace(workspaceId);
    const integration = integrations.find((candidate) => candidate.provider === provider);
    return { connected: integration?.enabled ?? false, tokenExpiresAt: integration?.tokenExpiresAt ?? null };
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface ExecutionRow {
  id: string;
  workspace_id: string;
  provider: IntegrationProvider;
  action_type: string;
  status: ExecutionStatus;
  request_payload: ExecutionRequestPayload;
  response_summary: Record<string, unknown> | null;
  error_details: string | null;
  pending_approval_id: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapExecutionRow(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    actionType: row.action_type,
    status: row.status,
    requestPayload: row.request_payload,
    responseSummary: row.response_summary,
    errorDetails: row.error_details,
    pendingApprovalId: row.pending_approval_id,
    startedAt: toIsoOrNull(row.started_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}
