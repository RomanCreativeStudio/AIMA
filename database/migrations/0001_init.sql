-- AIMA — initial schema
-- Covers: Users, Workspaces, Conversations, Messages, Memory, Tasks, Permissions
-- (docs/TECHNICAL_ARCHITECTURE.md §3, §5, §6)
--
-- Every workspace-scoped table carries a workspace_id foreign key. This is a
-- security boundary, not just an organizational convenience — the backend
-- must never issue a query that omits it (docs/TECHNICAL_ARCHITECTURE.md §6).

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";   -- pgvector, for memory/knowledge embeddings

-- ─────────────────────────────────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Workspaces — the four fixed workspace kinds from docs/PRODUCT_BIBLE.md §1
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE workspace_slug AS ENUM ('personal', 'rcs', 'mfs', 'development');

CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        workspace_slug NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Conversations & Messages
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_workspace ON conversations(workspace_id);

CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role             message_role NOT NULL,
  content          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_workspace ON messages(workspace_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Memory — durable, workspace-scoped long-term memory records
-- (docs/TECHNICAL_ARCHITECTURE.md §4). embedding dimension matches the
-- embedding model chosen in the Intelligence Sprint; 1536 is a placeholder
-- (OpenAI text-embedding-3-small / Voyage-compatible dimension) to be
-- confirmed when retrieval is implemented.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE memory_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  source        TEXT,
  embedding     VECTOR(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_records_workspace ON memory_records(workspace_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Tasks — personal/project tasks across all four workspaces
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done', 'cancelled');

CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  status        task_status NOT NULL DEFAULT 'todo',
  due_date      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_workspace ON tasks(workspace_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Permissions — the capability registry, per-workspace tier overrides,
-- pending approvals, and the action log (docs/TECHNICAL_ARCHITECTURE.md §5)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE permission_tier AS ENUM ('suggest', 'prepare', 'execute_with_approval', 'automatic_safe');

-- Mirrors backend/src/permissions/registry.ts. The backend's in-code registry
-- is authoritative for the Foundation Sprint; syncing it into this table
-- (so overrides below can reference it by id) is Integration Sprint scope.
CREATE TABLE capabilities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type   TEXT NOT NULL UNIQUE,
  default_tier  permission_tier NOT NULL,
  tier_locked   BOOLEAN NOT NULL DEFAULT false,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User-promoted tier overrides, scoped per workspace. A row here only ever
-- takes effect if the referenced capability is not tier_locked
-- (docs/PRODUCT_BIBLE.md §5).
CREATE TABLE workspace_capability_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability_id  UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  tier           permission_tier NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, capability_id)
);

-- Tier 3 ("execute_with_approval") intents awaiting explicit user confirmation.
CREATE TABLE pending_approvals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability_id  UUID NOT NULL REFERENCES capabilities(id),
  payload        JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX idx_pending_approvals_workspace ON pending_approvals(workspace_id);

-- Audit trail for every Tier 3/4 execution. Written by
-- backend/src/actionLog/logger.ts; never optional, never best-effort
-- (docs/TECHNICAL_ARCHITECTURE.md §5).
CREATE TABLE action_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability_id  UUID REFERENCES capabilities(id),
  tier           permission_tier NOT NULL,
  summary        TEXT NOT NULL,
  payload        JSONB,
  outcome        TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_log_workspace ON action_log(workspace_id);
