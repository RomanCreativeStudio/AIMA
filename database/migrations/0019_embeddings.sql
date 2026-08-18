-- AIMA Phase 3.6 — Semantic Search & Context Retrieval: a generic embedding
-- store for content types that have no dedicated embedding column of their
-- own (conversations, tasks, notes, future document types), so retrieval
-- can rank across all of them without a bespoke table per type
-- (docs/decisions/0021-semantic-search-and-context-retrieval.md).
--
-- Deliberately separate from `memory_records.embedding`/`document_chunks.
-- embedding` (Phases 1.2/1.5/3.4) — those already have first-class,
-- well-tested embedding columns and retrieval paths; this table doesn't
-- duplicate them, it covers what they don't.

-- One row per distinct (provider, model) pair actually used to produce a
-- vector — lets a stored embedding record exactly which model produced it,
-- without repeating the provider/model name/dimensions on every row.
CREATE TABLE embedding_models (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name  TEXT NOT NULL,
  model_name     TEXT NOT NULL,
  dimensions     INT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_name, model_name)
);

-- 'note' and 'document' are forward-compatible placeholders: no Notes
-- feature and no generic document type exist in this codebase yet
-- (`documents`/`document_chunks`, Phase 1.5, already covers imported
-- files) — the enum is ready for them without a future migration.
CREATE TYPE embedding_source_type AS ENUM ('memory', 'conversation', 'task', 'note', 'document');

CREATE TABLE embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_type         embedding_source_type NOT NULL,
  -- Not a foreign key: source_id points into whichever table source_type
  -- names (conversations, tasks, ...), and no single REFERENCES target
  -- could satisfy every source_type. Workspace isolation is still enforced
  -- directly via workspace_id on every query, not through this column.
  source_id           UUID NOT NULL,
  chunk_index         INT NOT NULL DEFAULT 0,
  -- Denormalized alongside content_hash (mirrors document_chunks.content)
  -- so a search result can render a snippet without joining back to
  -- whichever source table produced it.
  content             TEXT NOT NULL,
  -- sha256 of `content` — lets EmbeddingService detect unchanged content on
  -- reindex and skip re-embedding it, rather than re-calling the provider
  -- for text that hasn't changed.
  content_hash        TEXT NOT NULL,
  embedding_model_id  UUID NOT NULL REFERENCES embedding_models(id),
  -- Increments each time this (workspace, source, chunk) row is
  -- re-embedded — a plain change counter, not tied to embedding_model_id
  -- (switching providers still increments it).
  embedding_version   INT NOT NULL DEFAULT 1,
  embedding           VECTOR(1536) NOT NULL,
  indexed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_type, source_id, chunk_index)
);

CREATE INDEX idx_embeddings_workspace ON embeddings(workspace_id);
CREATE INDEX idx_embeddings_source ON embeddings(workspace_id, source_type, source_id);
CREATE INDEX idx_embeddings_vector ON embeddings USING hnsw (embedding vector_cosine_ops);
