-- Workflow Orchestration Foundation (Phase 2.4): multi-step, approval-gated
-- sequences built on top of the existing capability/approval machinery
-- rather than a parallel one (docs/decisions/0012-workflow-orchestration-
-- foundation.md). A run advances one step at a time; a step gated by a
-- Tier 3 capability pauses the run at 'awaiting_approval' and creates a
-- real pending_approvals row via the existing ApprovalEngine — the run
-- only performs that step's actual effect once resumed after approval.

-- "Create GitHub issue draft" (one of this phase's four built-in
-- workflows) needs a new held-content kind alongside email/proposal/
-- client_response/report (0007_drafts.sql) — it never touches GitHub
-- itself, only AIMA's own drafts table, consistent with every other draft
-- type.
ALTER TYPE draft_type ADD VALUE 'github_issue';

CREATE TYPE workflow_key AS ENUM (
  'draft_email_reply',
  'create_github_issue_draft',
  'summarize_unread_email',
  'daily_workspace_briefing'
);

CREATE TYPE workflow_run_status AS ENUM (
  'pending',
  'running',
  'awaiting_approval',
  'paused',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE workflow_step_status AS ENUM (
  'pending',
  'completed',
  'awaiting_approval',
  'failed',
  'skipped'
);

-- `sequence` gives history listing a stable "newest first" ordering
-- independent of `created_at` collisions — the same frozen-`now()` fix as
-- `messages.sequence` (0003), `pending_approvals.sequence` (0006), and
-- `conversations.sequence` (0010), now on a fourth table.
CREATE TABLE workflow_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_key        workflow_key NOT NULL,
  status              workflow_run_status NOT NULL DEFAULT 'pending',
  current_step_index  INT NOT NULL DEFAULT 0,
  input               JSONB NOT NULL DEFAULT '{}'::jsonb,
  result              JSONB,
  sequence            BIGSERIAL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_workflow_runs_workspace ON workflow_runs(workspace_id);
CREATE INDEX idx_workflow_runs_workspace_sequence ON workflow_runs(workspace_id, sequence DESC);

CREATE TABLE workflow_step_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id     UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_index          INT NOT NULL,
  step_key            TEXT NOT NULL,
  status              workflow_step_status NOT NULL DEFAULT 'pending',
  capability_id       UUID REFERENCES capabilities(id),
  -- ON DELETE SET NULL, not the default RESTRICT: `pending_approvals` rows
  -- are also deleted via workspaces' own ON DELETE CASCADE, a separate
  -- cascade path from this table's own workflow_run_id -> workflow_runs ->
  -- workspaces chain. Leaving this RESTRICT deadlocks a workspace delete
  -- against its own pending_approvals rows.
  pending_approval_id UUID REFERENCES pending_approvals(id) ON DELETE SET NULL,
  output              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, step_index)
);

CREATE INDEX idx_workflow_step_runs_run ON workflow_step_runs(workflow_run_id);
