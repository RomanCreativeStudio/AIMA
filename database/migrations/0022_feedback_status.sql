-- Internal Operator Dashboard sprint: adds a triage status to feedback submissions so the admin dashboard
-- can show where each one stands. Feedback previously had no lifecycle concept at all — this is the one
-- schema change this sprint needed (everything else reuses existing tables/services).
--
-- No mutation endpoint ships this sprint (display-only) — every row defaults to 'new'. A future sprint can
-- add a PATCH to advance status without needing another migration.
--
-- Purely additive: no existing column altered, no existing data touched beyond the new column's default.
-- Rollback: ALTER TABLE feedback DROP COLUMN status; DROP TYPE IF EXISTS feedback_status;

CREATE TYPE feedback_status AS ENUM ('new', 'reviewed', 'resolved');

ALTER TABLE feedback ADD COLUMN status feedback_status NOT NULL DEFAULT 'new';
