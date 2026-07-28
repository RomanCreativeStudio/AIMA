-- AIMA Phase 3.4 — Advanced Memory System: upgrades memory_records from
-- plain storage/retrieval into a scored, lifecycle-aware memory system
-- (docs/decisions/0019-advanced-memory-system.md).
--
-- Backward compatible: every new column is either nullable or carries a
-- default, so every memory row written by Phases 1.2–3.3 remains valid and
-- readable without a data backfill. "Categories" are not a new column —
-- the existing `scope` enum (user/workspace/conversation/project,
-- 0002_memory_scopes.sql) already is the category dimension; this
-- migration adds the *scoring* and *lifecycle* dimensions on top of it.

CREATE TYPE memory_type AS ENUM ('short_term', 'long_term');

ALTER TABLE memory_records
  -- How significant this memory is to the workspace, independent of any
  -- one query's similarity score — set at creation, adjustable afterward.
  ADD COLUMN importance_score REAL NOT NULL DEFAULT 0.5,
  -- How much the source of this memory should be trusted — 1.0 for a
  -- user-authored memory (the default; a human said it, it's certain),
  -- lower for an AI-detected candidate the user then chose to save.
  ADD COLUMN confidence_score REAL NOT NULL DEFAULT 1.0,
  -- short_term memories are eligible for expires_at-based exclusion from
  -- retrieval; long_term (the default) never expire on their own.
  ADD COLUMN memory_type memory_type NOT NULL DEFAULT 'long_term',
  -- Updated whenever a memory is returned by a search/context read —
  -- lets a future "unused memory" view exist without new machinery.
  ADD COLUMN last_accessed_at TIMESTAMPTZ,
  -- Only meaningful for short_term memories; NULL means "no expiration set".
  ADD COLUMN expires_at TIMESTAMPTZ,
  -- Soft-delete for the "archive" lifecycle action — an archived memory is
  -- excluded from search/context retrieval but not destroyed, distinct from
  -- a hard DELETE (docs/decisions/0019-advanced-memory-system.md).
  ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE memory_records
  ADD CONSTRAINT memory_importance_score_range CHECK (importance_score >= 0 AND importance_score <= 1),
  ADD CONSTRAINT memory_confidence_score_range CHECK (confidence_score >= 0 AND confidence_score <= 1);

-- Retrieval always excludes archived memories and (for short_term memories)
-- anything past its expiration — a partial index keeps that filter cheap.
CREATE INDEX idx_memory_records_active ON memory_records(workspace_id)
  WHERE archived_at IS NULL;
