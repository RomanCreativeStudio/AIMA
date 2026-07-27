-- User Profile System (Phase 1.8): preferences, communication style, and a
-- default workspace, alongside the display_name/timestamps already added
-- in 0001_init.sql. `preferences` here is a simple account-level settings
-- blob (e.g. future UI/notification settings) — distinct from the
-- structured, workspace-scoped Preference Memory Layer added in
-- 0009_preferences.sql, which is what actually shapes AI behavior.
ALTER TABLE users ADD COLUMN preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN communication_style TEXT;
ALTER TABLE users ADD COLUMN default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

-- Workspace Configuration System (Phase 1.8): a generic `type` category
-- (independent of the fixed `slug` identity from 0001_init.sql) plus
-- per-workspace customization. `type` is nullable at the database level —
-- WorkspaceService always resolves and stores it explicitly for workspaces
-- created through it, but a NULL falls back to a slug-based default in
-- application code (backend/src/types/workspace.ts#WORKSPACE_TYPE_BY_SLUG),
-- so every existing row and test helper that inserts a bare
-- (user_id, slug, name) keeps working unchanged (docs/decisions/
-- 0008-user-identity-and-workspace-intelligence.md).
CREATE TYPE workspace_type AS ENUM ('personal', 'business', 'creative', 'development');

ALTER TABLE workspaces ADD COLUMN type workspace_type;
ALTER TABLE workspaces ADD COLUMN instructions TEXT;
ALTER TABLE workspaces ADD COLUMN assistant_behavior JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspaces ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspaces ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
