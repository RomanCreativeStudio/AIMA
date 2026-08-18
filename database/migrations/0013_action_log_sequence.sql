-- AIMA — stable action_log ordering (Phase 2.5, Productivity Intelligence)
--
-- Same bug as messages.sequence (0003), pending_approvals.sequence (0006),
-- conversations.sequence (0010), and workflow_runs.sequence (0012): under
-- READ COMMITTED, now() is frozen at transaction start, so several
-- action_log rows written within one transaction/request can share an
-- identical created_at, leaving ORDER BY created_at's tie order
-- undefined. BriefingService's "recent activity" feed (ActionLogger.list)
-- needs a stable newest-first order, so this is the fifth table to get
-- the same monotonic sequence column fix.

ALTER TABLE action_log ADD COLUMN sequence BIGSERIAL;

CREATE INDEX idx_action_log_workspace_sequence ON action_log(workspace_id, sequence DESC);
