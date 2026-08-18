-- Beta Invitations & Notifications sprint: founder-issued invitations to prospective beta testers.
-- Audited first: an invitation is fundamentally not "preferences on an existing user" like betaTester/
-- adminNotes/adminTags (Beta Tester Management sprint) — the invitee typically has no `users` row yet, so
-- there is nothing to attach a preference to. This is genuinely new data, unlike every prior admin sprint
-- that reused the existing preferences JSONB blob.
--
-- invited_by references the admin who sent it (an existing users.id, verified by requireAdmin before this
-- row is ever inserted). No FK/uniqueness on email: an invitee has no users row at signup time, and this
-- sprint doesn't need to prevent re-inviting the same address (only "already an active beta tester" is
-- rejected, at the service layer via UserService.getUserByEmail).
--
-- `sequence` (not `created_at`) is what listing orders by — the same fix already applied to messages
-- (0003), pending_approvals (0006), conversations (0010), action_log (0013), and feedback (0021): under
-- READ COMMITTED, now() is frozen at transaction start, so several invitations written within one
-- transaction/request can share an identical created_at, leaving ORDER BY created_at's tie order undefined.
--
-- Purely additive: no existing table altered, no existing data touched.
-- Rollback: DROP TABLE IF EXISTS invitations; DROP TYPE IF EXISTS invitation_status;

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired');

CREATE TABLE invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  invited_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      invitation_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence    BIGSERIAL
);

CREATE INDEX idx_invitations_sequence ON invitations(sequence DESC);
