import type { WorkflowDefinition, WorkflowRunInput } from '../types';

/**
 * What a step handler needs to do its work: the run's original input, plus
 * every prior step's recorded output (keyed by step key) so a later step
 * can build on an earlier one without the engine needing to know what
 * "building on" means for any particular workflow.
 */
export interface WorkflowStepContext {
  workspaceId: string;
  input: WorkflowRunInput;
  priorOutputs: Record<string, Record<string, unknown>>;
}

/**
 * The step execution framework's provider abstraction (Phase 2.4, item 1)
 * — mirrors `IntegrationConnector`/`AIProvider`: `WorkflowService` depends
 * only on this interface, never on a specific workflow's business logic.
 * `executeStep` performs that step's *actual* effect — for a
 * capability-gated step, `WorkflowService` only ever calls this after the
 * step's approval has been granted, never before.
 */
export interface WorkflowHandler {
  readonly definition: WorkflowDefinition;
  executeStep(stepIndex: number, context: WorkflowStepContext): Promise<Record<string, unknown>>;
}
