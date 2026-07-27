-- AIMA — knowledge ingestion: documents and document_chunks (Phase 1.5)
--
-- Deliberately separate from memory_records: documents are bulk-ingested
-- reference material (imported files) with their own lifecycle (import,
-- re-index, delete), while memory_records are durable facts/preferences the
-- assistant or user chose to remember (docs/decisions/0005-knowledge-
-- ingestion.md). Both are workspace-scoped and both feed retrieval.

CREATE TYPE document_format AS ENUM ('markdown', 'plaintext', 'pdf');

CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT,
  format        document_format NOT NULL,
  source        TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  version       TEXT,
  -- The canonical parsed text, kept so a document can be re-chunked/
  -- re-embedded (re-index) without the caller re-supplying the content.
  raw_content   TEXT NOT NULL,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_workspace ON documents(workspace_id);

CREATE TABLE document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- Denormalized from documents.workspace_id so every isolation-sensitive
  -- query here filters directly on workspace_id without a join
  -- (docs/TECHNICAL_ARCHITECTURE.md §6).
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  section       TEXT,
  content       TEXT NOT NULL,
  embedding     VECTOR(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_document_chunks_workspace ON document_chunks(workspace_id);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
