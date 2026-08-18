-- The Action Preparation Layer (Phase 1.7): a foundation for future prepared
-- content — email drafts, client responses, proposals, reports — that a user
-- reviews before anything is sent. No execution happens here; a draft is
-- just held text until a future Tier 3 capability (e.g. send_email) acts on
-- it, which is out of scope for this phase.
CREATE TYPE draft_type AS ENUM ('email', 'proposal', 'client_response', 'report');

CREATE TABLE drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type          draft_type NOT NULL,
  title         TEXT,
  content       TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drafts_workspace ON drafts(workspace_id);
