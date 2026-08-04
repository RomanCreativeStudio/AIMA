-- Beta Tester Infrastructure: minimal feedback/bug-report/feature-request storage for external beta
-- testers. Audited first (no existing table fits without misusing its semantics — action_log requires a
-- capability_id/tier/outcome shaped around capability executions, not freeform user submissions; preferences
-- is a single JSONB blob per user, not a growing list of timestamped entries).
--
-- Workspace-scoped like every other resource table (docs/TECHNICAL_ARCHITECTURE.md §6) -- the backend must
-- never issue a query that omits workspace_id. Isolation is enforced by the existing
-- requireWorkspaceOwnership middleware already wired for every /api/workspaces/:workspaceId/* route -- no
-- new authorization mechanism needed. user_id records who submitted it, kept separate from the workspace's
-- own owner (workspaces.user_id) so a future multi-user workspace never needs a migration to retrofit
-- authorship.
--
-- Purely additive: no existing table altered, no existing data read/modified/referenced.
-- Rollback: DROP TABLE IF EXISTS feedback; DROP TYPE IF EXISTS feedback_type;

CREATE TYPE feedback_type AS ENUM ('bug', 'feature', 'general');

-- `sequence` (not `created_at`) is what listing orders by — the same fix already applied to messages
-- (0003), pending_approvals (0006), conversations (0010), and action_log (0013): under READ COMMITTED,
-- now() is frozen at transaction start, so several feedback rows written within one transaction/request
-- can share an identical created_at, leaving ORDER BY created_at's tie order undefined.
CREATE TABLE feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          feedback_type NOT NULL DEFAULT 'general',
  message       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence      BIGSERIAL
);

CREATE INDEX idx_feedback_workspace_sequence ON feedback(workspace_id, sequence DESC);
