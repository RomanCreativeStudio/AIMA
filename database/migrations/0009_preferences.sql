-- The Preference Memory Layer (Phase 1.8): structured, categorized
-- preferences that shape assistant behavior, kept separate from
-- freeform `memory_records` because these are keyed settings
-- ("writing_style.tone = formal"), not durable facts — retrieved in full
-- for a workspace and injected into the system prompt (docs/decisions/
-- 0008-user-identity-and-workspace-intelligence.md).
CREATE TYPE preference_category AS ENUM (
  'writing_style',
  'response_preferences',
  'workflow_preferences',
  'project_rules'
);

CREATE TABLE preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category      preference_category NOT NULL,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, category, key)
);

CREATE INDEX idx_preferences_workspace ON preferences(workspace_id);
