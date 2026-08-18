-- AIMA — Task Foundation priority field (Phase 1.6)
--
-- `tasks` was created in 0001_init.sql with id/workspace/title/description/
-- status/timestamps but no priority column. Adds it now that
-- backend/src/tasks/taskService.ts gives the table its first real caller.

CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');

ALTER TABLE tasks ADD COLUMN priority task_priority NOT NULL DEFAULT 'medium';
