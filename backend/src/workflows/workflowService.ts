import type { ApprovalEngine } from '../approval/approvalEngine';
import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import type { WorkflowHandler } from './handlers/types';
import { InvalidWorkflowStateError, WorkflowApprovalNotYetGrantedError, WorkflowRunNotFoundError } from './errors';
import type { WorkflowRegistry } from './registry';
import type {
  CreateWorkflowRunInput,
  WorkflowKey,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowStepStatus,
} from './types';

/**
 * The Workflow Engine's step execution framework and execution-state
 * tracking (Phase 2.4, items 1 and 3), built entirely on top of the
 * existing capability/approval machinery rather than a parallel one:
 * `executeNextStep` advances a run by exactly one step, never more — a
 * step gated by a Tier 3 capability calls `ApprovalEngine.evaluate` and
 * pauses at `awaiting_approval` *before* performing that step's real
 * effect; only `resume`, called after the approval is granted, ever
 * performs it. Nothing here executes automatically end to end — every
 * step is one explicit call, and every external step is approval-gated by
 * construction, not by convention (docs/decisions/0012-workflow-
 * orchestration-foundation.md).
 */
export class WorkflowService {
  constructor(
    private readonly db: Queryable,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly handlers: Record<WorkflowKey, WorkflowHandler>,
    private readonly approvalEngine: ApprovalEngine,
  ) {}

  async createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunDetail> {
    await this.assertWorkspaceExists(input.workspaceId);
    const definition = this.getDefinition(input.workflowKey);

    const runResult = await this.db.query<WorkflowRunRow>(
      `INSERT INTO workflow_runs (workspace_id, workflow_key, status, current_step_index, input)
       VALUES ($1, $2, 'pending', 0, $3::jsonb)
       RETURNING id, workspace_id, workflow_key, status, current_step_index, input, result, created_at, updated_at, completed_at`,
      [input.workspaceId, input.workflowKey, JSON.stringify(input.input)],
    );
    const run = mapRunRow(runResult.rows[0]);

    const steps: WorkflowStepRun[] = [];
    for (let stepIndex = 0; stepIndex < definition.steps.length; stepIndex += 1) {
      const step = definition.steps[stepIndex];
      const capabilityId = step.capability ? await this.getCapabilityId(step.capability) : null;

      const stepResult = await this.db.query<WorkflowStepRunRow>(
        `INSERT INTO workflow_step_runs (workflow_run_id, step_index, step_key, status, capability_id)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING id, workflow_run_id, step_index, step_key, status, pending_approval_id, output, created_at, updated_at,
                   $5::text AS capability`,
        [run.id, stepIndex, step.key, capabilityId, step.capability ?? null],
      );
      steps.push(mapStepRow(stepResult.rows[0]));
    }

    return { ...run, steps };
  }

  async getRun(workspaceId: string, runId: string): Promise<WorkflowRunDetail> {
    const run = await this.fetchRun(workspaceId, runId);
    const steps = await this.fetchSteps(runId);
    return { ...run, steps };
  }

  async listRuns(workspaceId: string): Promise<WorkflowRun[]> {
    await this.assertWorkspaceExists(workspaceId);
    const result = await this.db.query<WorkflowRunRow>(
      `SELECT id, workspace_id, workflow_key, status, current_step_index, input, result, created_at, updated_at, completed_at
       FROM workflow_runs WHERE workspace_id = $1 ORDER BY sequence DESC`,
      [workspaceId],
    );
    return result.rows.map(mapRunRow);
  }

  /**
   * Advances a `pending`/`running` run by exactly one step. A step with no
   * capability, or one whose capability doesn't require approval, executes
   * immediately. A step gated by a Tier 3 capability creates a pending
   * approval and stops — the run becomes `awaiting_approval` without the
   * step's real effect ever happening.
   */
  async executeNextStep(workspaceId: string, runId: string): Promise<WorkflowRunDetail> {
    const run = await this.fetchRun(workspaceId, runId);
    if (run.status !== 'pending' && run.status !== 'running') {
      throw new InvalidWorkflowStateError('execute', run.status);
    }

    const definition = this.getDefinition(run.workflowKey);
    const step = definition.steps[run.currentStepIndex];

    if (step.capability) {
      const decision = await this.approvalEngine.evaluate(workspaceId, step.capability, {
        workflowRunId: runId,
        stepKey: step.key,
        input: run.input,
      });

      if (decision.state === 'pending' && decision.pendingApprovalId) {
        await this.db.query(
          `UPDATE workflow_step_runs SET status = 'awaiting_approval', pending_approval_id = $1, updated_at = now()
           WHERE workflow_run_id = $2 AND step_index = $3`,
          [decision.pendingApprovalId, runId, run.currentStepIndex],
        );
        await this.setRunStatus(runId, 'awaiting_approval');
        return this.getRun(workspaceId, runId);
      }
    }

    await this.performStep(workspaceId, run, step);
    return this.getRun(workspaceId, runId);
  }

  async pause(workspaceId: string, runId: string): Promise<WorkflowRunDetail> {
    const run = await this.fetchRun(workspaceId, runId);
    if (run.status !== 'pending' && run.status !== 'running') {
      throw new InvalidWorkflowStateError('pause', run.status);
    }
    await this.setRunStatus(runId, 'paused');
    return this.getRun(workspaceId, runId);
  }

  /**
   * Resumes a `paused` run (simply back to `running`) or an
   * `awaiting_approval` run — the latter only proceeds once the blocking
   * approval has actually been granted, checked fresh against
   * `ApprovalEngine` rather than trusted from whenever it was created.
   */
  async resume(workspaceId: string, runId: string): Promise<WorkflowRunDetail> {
    const run = await this.fetchRun(workspaceId, runId);

    if (run.status === 'paused') {
      await this.setRunStatus(runId, 'running');
      return this.getRun(workspaceId, runId);
    }

    if (run.status !== 'awaiting_approval') {
      throw new InvalidWorkflowStateError('resume', run.status);
    }

    const steps = await this.fetchSteps(runId);
    const blockingStep = steps.find((step) => step.stepIndex === run.currentStepIndex);
    if (!blockingStep?.pendingApprovalId) {
      throw new Error(`Workflow run ${runId} is awaiting_approval but has no pending_approval_id recorded`);
    }

    const approval = await this.approvalEngine.get(workspaceId, blockingStep.pendingApprovalId);

    if (approval.status === 'pending') {
      throw new WorkflowApprovalNotYetGrantedError(runId);
    }

    if (approval.status === 'approved') {
      const definition = this.getDefinition(run.workflowKey);
      const step = definition.steps[run.currentStepIndex];
      await this.performStep(workspaceId, run, step);
      return this.getRun(workspaceId, runId);
    }

    // Rejected or expired — a legitimate terminal outcome, not an error.
    await this.db.query(
      `UPDATE workflow_step_runs SET status = 'failed', output = $1::jsonb, updated_at = now()
       WHERE workflow_run_id = $2 AND step_index = $3`,
      [JSON.stringify({ error: `Approval ${approval.status}` }), runId, run.currentStepIndex],
    );
    await this.db.query(
      `UPDATE workflow_runs SET status = 'failed', completed_at = now(), updated_at = now() WHERE id = $1`,
      [runId],
    );
    return this.getRun(workspaceId, runId);
  }

  async cancel(workspaceId: string, runId: string): Promise<WorkflowRunDetail> {
    const run = await this.fetchRun(workspaceId, runId);
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      throw new InvalidWorkflowStateError('cancel', run.status);
    }

    await this.db.query(
      `UPDATE workflow_step_runs SET status = 'skipped', updated_at = now()
       WHERE workflow_run_id = $1 AND step_index = $2 AND status IN ('pending', 'awaiting_approval')`,
      [runId, run.currentStepIndex],
    );
    await this.db.query(
      `UPDATE workflow_runs SET status = 'cancelled', completed_at = now(), updated_at = now() WHERE id = $1`,
      [runId],
    );
    return this.getRun(workspaceId, runId);
  }

  /** Actually performs a step's effect — called only for an ungated step, a step whose capability doesn't require approval, or a gated step whose approval was just confirmed granted. Never called speculatively. */
  private async performStep(
    workspaceId: string,
    run: WorkflowRun,
    step: { key: string },
  ): Promise<void> {
    const handler = this.handlers[run.workflowKey];
    const priorOutputs = await this.collectPriorOutputs(run.id);

    let output: Record<string, unknown>;
    try {
      output = await handler.executeStep(run.currentStepIndex, {
        workspaceId,
        input: run.input,
        priorOutputs,
      });
    } catch (error) {
      await this.db.query(
        `UPDATE workflow_step_runs SET status = 'failed', output = $1::jsonb, updated_at = now()
         WHERE workflow_run_id = $2 AND step_index = $3`,
        [JSON.stringify({ error: (error as Error).message }), run.id, run.currentStepIndex],
      );
      await this.db.query(
        `UPDATE workflow_runs SET status = 'failed', completed_at = now(), updated_at = now() WHERE id = $1`,
        [run.id],
      );
      return;
    }

    await this.db.query(
      `UPDATE workflow_step_runs SET status = 'completed', output = $1::jsonb, updated_at = now()
       WHERE workflow_run_id = $2 AND step_index = $3`,
      [JSON.stringify(output), run.id, run.currentStepIndex],
    );

    const definition = this.getDefinition(run.workflowKey);
    const nextStepIndex = run.currentStepIndex + 1;
    const isLastStep = nextStepIndex >= definition.steps.length;

    if (isLastStep) {
      await this.db.query(
        `UPDATE workflow_runs
         SET status = 'completed', current_step_index = $1, result = $2::jsonb, completed_at = now(), updated_at = now()
         WHERE id = $3`,
        [nextStepIndex, JSON.stringify(output), run.id],
      );
    } else {
      await this.db.query(
        `UPDATE workflow_runs SET status = 'running', current_step_index = $1, updated_at = now() WHERE id = $2`,
        [nextStepIndex, run.id],
      );
    }
  }

  private async collectPriorOutputs(runId: string): Promise<Record<string, Record<string, unknown>>> {
    const steps = await this.fetchSteps(runId);
    const priorOutputs: Record<string, Record<string, unknown>> = {};
    for (const step of steps) {
      if (step.status === 'completed' && step.output) {
        priorOutputs[step.stepKey] = step.output;
      }
    }
    return priorOutputs;
  }

  private async setRunStatus(runId: string, status: WorkflowRunStatus): Promise<void> {
    await this.db.query('UPDATE workflow_runs SET status = $1, updated_at = now() WHERE id = $2', [status, runId]);
  }

  private async fetchRun(workspaceId: string, runId: string): Promise<WorkflowRun> {
    const result = await this.db.query<WorkflowRunRow>(
      `SELECT id, workspace_id, workflow_key, status, current_step_index, input, result, created_at, updated_at, completed_at
       FROM workflow_runs WHERE id = $1 AND workspace_id = $2`,
      [runId, workspaceId],
    );
    if (result.rows.length === 0) {
      throw new WorkflowRunNotFoundError(runId, workspaceId);
    }
    return mapRunRow(result.rows[0]);
  }

  private async fetchSteps(runId: string): Promise<WorkflowStepRun[]> {
    const result = await this.db.query<WorkflowStepRunRow>(
      `SELECT wsr.id, wsr.workflow_run_id, wsr.step_index, wsr.step_key, wsr.status, wsr.pending_approval_id, wsr.output,
              wsr.created_at, wsr.updated_at, c.action_type AS capability
       FROM workflow_step_runs wsr
       LEFT JOIN capabilities c ON c.id = wsr.capability_id
       WHERE wsr.workflow_run_id = $1
       ORDER BY wsr.step_index ASC`,
      [runId],
    );
    return result.rows.map(mapStepRow);
  }

  private async getCapabilityId(actionType: string): Promise<string | null> {
    const result = await this.db.query<{ id: string }>('SELECT id FROM capabilities WHERE action_type = $1', [
      actionType,
    ]);
    return result.rows[0]?.id ?? null;
  }

  private getDefinition(key: WorkflowKey) {
    const definition = this.workflowRegistry.get(key);
    if (!definition) {
      throw new Error(`Unregistered workflow: "${key}"`);
    }
    return definition;
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface WorkflowRunRow {
  id: string;
  workspace_id: string;
  workflow_key: WorkflowKey;
  status: WorkflowRunStatus;
  current_step_index: number;
  input: Record<string, string>;
  result: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

function mapRunRow(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workflowKey: row.workflow_key,
    status: row.status,
    currentStepIndex: row.current_step_index,
    input: row.input,
    result: row.result,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

interface WorkflowStepRunRow {
  id: string;
  workflow_run_id: string;
  step_index: number;
  step_key: string;
  status: WorkflowStepStatus;
  pending_approval_id: string | null;
  output: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  capability: string | null;
}

function mapStepRow(row: WorkflowStepRunRow): WorkflowStepRun {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepIndex: row.step_index,
    stepKey: row.step_key,
    status: row.status,
    capability: row.capability,
    pendingApprovalId: row.pending_approval_id,
    output: row.output,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
