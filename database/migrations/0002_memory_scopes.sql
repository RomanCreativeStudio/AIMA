-- AIMA — memory scope model (Intelligence Sprint)
-- Extends memory_records so a single table can represent the four memory
-- categories from docs/PRODUCT_BIBLE.md: user, workspace, conversation, and
-- project memories (docs/TECHNICAL_ARCHITECTURE.md §4).
--
-- Design note: every memory row still carries a required workspace_id —
-- workspace isolation (docs/TECHNICAL_ARCHITECTURE.md §6) is never relaxed.
-- "user" scope here means a durable personal-preference fact recorded within
-- a given workspace (e.g. "always draft proposals in a formal tone"), not a
-- cross-workspace global memory. True cross-workspace recall remains the
-- explicit, logged bridging described in docs/PRODUCT_BIBLE.md §6 — it is
-- not implemented by this migration.

CREATE TYPE memory_scope AS ENUM ('user', 'workspace', 'conversation', 'project');

ALTER TABLE memory_records
  ADD COLUMN scope memory_scope NOT NULL DEFAULT 'workspace',
  ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  ADD COLUMN project_key TEXT,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- A conversation-scoped memory must reference the conversation it came from;
-- a project-scoped memory must carry a project_key. Enforced at the schema
-- level so a caller cannot silently create an ambiguous memory.
ALTER TABLE memory_records
  ADD CONSTRAINT memory_scope_consistency CHECK (
    (scope <> 'conversation' OR conversation_id IS NOT NULL) AND
    (scope <> 'project' OR project_key IS NOT NULL)
  );

CREATE INDEX idx_memory_records_scope ON memory_records(workspace_id, scope);
CREATE INDEX idx_memory_records_conversation ON memory_records(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_memory_records_project ON memory_records(workspace_id, project_key) WHERE project_key IS NOT NULL;

-- Vector similarity index for retrieval (docs/TECHNICAL_ARCHITECTURE.md §4).
-- HNSW over cosine distance; partial because embedding is nullable until a
-- memory has been embedded.
CREATE INDEX idx_memory_records_embedding ON memory_records
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
