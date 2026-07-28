export const WORKFLOW_KEYS = [
  'draft_email_reply',
  'create_github_issue_draft',
  'summarize_unread_email',
  'daily_workspace_briefing',
] as const;
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

export function isWorkflowKey(value: string): value is WorkflowKey {
  return (WORKFLOW_KEYS as readonly string[]).includes(value);
}

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'awaiting_approval',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = ['pending', 'completed', 'awaiting_approval', 'failed', 'skipped'] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

/**
 * One step's static metadata (backend/src/workflows/registry.ts) — separate
 * from `WorkflowStepRun`, which is that step's actual execution record for
 * one run. `capability` names the capability (registered in
 * `backend/src/permissions/registry.ts`) gating this step, if any; a step
 * with no capability is internal and always auto-executes (never touches
 * anything outside AIMA).
 */
export interface WorkflowStepDefinition {
  key: string;
  displayName: string;
  capability?: string;
}

/**
 * One built-in workflow's static shape (Phase 2.4, item 1–2) — mirrors
 * `IntegrationDefinition`/`CapabilityDefinition`'s "describe it in a
 * registry, execute it elsewhere" split. `triggerPhrases` feeds
 * `WorkflowIntentMatcher`, which only ever *suggests* running a workflow —
 * matching a phrase never creates or executes a run by itself.
 */
export interface WorkflowDefinition {
  key: WorkflowKey;
  displayName: string;
  description: string;
  steps: WorkflowStepDefinition[];
  triggerPhrases: string[];
}

/** Free-form input a run was started with (e.g. `{ topic, recipientName }`) — shape varies per workflow, validated by that workflow's handler, not centrally. */
export type WorkflowRunInput = Record<string, string>;

export interface CreateWorkflowRunInput {
  workspaceId: string;
  workflowKey: WorkflowKey;
  input: WorkflowRunInput;
}

/** Mirrors `workflow_runs` (database/migrations/0012_workflows.sql), without embedded step detail — what a history list needs. */
export interface WorkflowRun {
  id: string;
  workspaceId: string;
  workflowKey: WorkflowKey;
  status: WorkflowRunStatus;
  currentStepIndex: number;
  input: WorkflowRunInput;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Mirrors `workflow_step_runs` — one step's actual execution record for one run. */
export interface WorkflowStepRun {
  id: string;
  workflowRunId: string;
  stepIndex: number;
  stepKey: string;
  status: WorkflowStepStatus;
  capability: string | null;
  pendingApprovalId: string | null;
  output: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** A run plus its full step history — what the Workflow detail screen (Phase 2.4, item 5) needs. */
export interface WorkflowRunDetail extends WorkflowRun {
  steps: WorkflowStepRun[];
}

/**
 * An advisory, non-executing preview (Phase 2.4, item 4: "Show workflow
 * preview") — surfaced on a chat response when `WorkflowIntentMatcher`
 * recognizes the user's message as describing one of the built-in
 * workflows. Never itself creates a `WorkflowRun`; starting one is always a
 * separate, explicit call.
 */
export interface WorkflowSuggestion {
  workflowKey: WorkflowKey;
  displayName: string;
  description: string;
  confidence: number;
  steps: WorkflowStepDefinition[];
  extractedInput: WorkflowRunInput;
}
