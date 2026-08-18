-- conversations needs a monotonic ordering column for "most recently
-- active first" (Phase 2.1's macOS conversation list) — the same problem
-- messages.sequence (0003_message_sequence.sql) and pending_approvals.sequence
-- (0006_approval_lifecycle.sql) already solved: Postgres freezes now() at
-- transaction start, so two conversations touched within the same
-- transaction can tie on updated_at, making timestamp-only ordering
-- unreliable.
ALTER TABLE conversations ADD COLUMN sequence BIGSERIAL;

CREATE INDEX idx_conversations_workspace_sequence ON conversations(workspace_id, sequence DESC);
