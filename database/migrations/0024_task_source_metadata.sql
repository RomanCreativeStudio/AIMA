-- Conversation → Action sprint: lets a task record where it came from.
--
-- Audited first: `tasks` (0001_init.sql, priority added in 0005_task_priority.sql) has no way to distinguish
-- a task a founder typed in by hand from one accepted out of a chat suggestion — needed so the Daily Briefing
-- can show "accepted tasks"/"unresolved follow-ups" without a second table. Mirrors the exact source+metadata
-- shape `memory_records` already uses (0017_memory_intelligence.sql) for the same "where did this come from"
-- need — reusing that convention rather than inventing a new one.
--
-- Both columns are nullable/defaulted so every existing row and every existing INSERT (manual task creation)
-- keeps working unchanged: `source` is NULL unless a caller explicitly passes one, `metadata` defaults to '{}'.
--
-- Purely additive: no existing column altered, no existing data touched.
-- Rollback: ALTER TABLE tasks DROP COLUMN source, DROP COLUMN metadata;

ALTER TABLE tasks ADD COLUMN source TEXT;
ALTER TABLE tasks ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
