-- Action Execution Foundation (Phase 2.6): the secure execution layer for
-- real external actions (Gmail send/draft, GitHub issue/PR), built on the
-- existing capability/approval/integration machinery rather than a
-- parallel one (docs/decisions/0014-action-execution-foundation.md).
--
-- `sequence` from the start (BIGSERIAL): every prior "newest first" table
-- (messages, pending_approvals, conversations, workflow_runs, action_log)
-- needed this fix after shipping without it under the frozen-now()
-- READ COMMITTED bug — added upfront here instead of as a follow-up.

CREATE TYPE execution_status AS ENUM ('pending', 'awaiting_approval', 'succeeded', 'failed');

CREATE TABLE executions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider            integration_provider NOT NULL,
  -- The capability action_type this execution performs (e.g. 'send_email',
  -- 'draft_gmail_email', 'create_github_issue', 'create_github_pull_request').
  action_type         TEXT NOT NULL,
  status              execution_status NOT NULL DEFAULT 'pending',
  request_payload     JSONB NOT NULL,
  response_summary    JSONB,
  error_details       TEXT,
  -- Same ON DELETE SET NULL reasoning as workflow_step_runs.pending_approval_id
  -- (0012_workflows.sql): a separate cascade chain (workspaces -> executions)
  -- from the direct one (workspaces -> pending_approvals) would otherwise
  -- block a workspace delete under the default RESTRICT.
  pending_approval_id UUID REFERENCES pending_approvals(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  sequence            BIGSERIAL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_executions_workspace_sequence ON executions(workspace_id, sequence DESC);
