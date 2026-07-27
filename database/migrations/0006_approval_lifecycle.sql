-- Renames the "declined" status to "rejected" (aligning with Phase 1.7's
-- approval vocabulary) and adds an expiry column. "expired" is never written
-- to `status` — it is a derived state (backend/src/approval/approvalEngine.ts
-- computes it from `expires_at` at read time), so a still-'pending' row past
-- its expiry is treated as expired without any background job.
UPDATE pending_approvals SET status = 'rejected' WHERE status = 'declined';

ALTER TABLE pending_approvals
  DROP CONSTRAINT pending_approvals_status_check;

ALTER TABLE pending_approvals
  ADD CONSTRAINT pending_approvals_status_check CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE pending_approvals
  ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours');

-- created_at alone can't order two approvals created in the same
-- transaction (Postgres' now() is frozen at transaction start), the same
-- problem messages.sequence solved for conversation history
-- (0003_message_sequence.sql) — pending_approvals needs the same fix now
-- that listing approvals newest-first is a real feature (Phase 1.7).
ALTER TABLE pending_approvals
  ADD COLUMN sequence BIGSERIAL;

CREATE INDEX idx_pending_approvals_workspace_sequence ON pending_approvals(workspace_id, sequence DESC);
