-- Authentication Implementation Foundation (Sprint 4.4, docs/decisions/
-- 0022-authentication-architecture.md). Local session/device storage: per
-- ADR-0022 Decision 3, device/session state is owned by AIMA's own
-- database, not the auth provider -- listing and revoking devices never
-- requires a live provider call. One row per issued session (one device/
-- client). The raw refresh token is never stored, only a hash of it
-- (ADR-0022 Decision 2/3).
--
-- Purely additive: no existing table is altered, and no existing data is
-- read, modified, or referenced by this migration.
--
-- Rollback: this migration is fully and trivially reversible with no
-- impact on any other table's data --
--   DROP TABLE IF EXISTS auth_sessions;
-- is the complete rollback. auth_sessions is referenced by nothing else
-- (no other table has a foreign key into it), so no cascading cleanup is
-- needed.

CREATE TABLE auth_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- User-facing label for the "signed in devices" list (ADR-0022
  -- Decision 3/6) -- e.g. "MacBook Pro", "iPhone". Nullable: not every
  -- client is expected to supply one at login.
  device_label        TEXT,
  -- SHA-256 hex digest of the current refresh token identifier
  -- (ADR-0022 Decision 2) -- never the raw token. Rotated on every
  -- successful refresh; looked up on each refresh attempt both to
  -- authenticate the request and to detect reuse of an
  -- already-rotated token (ADR-0022 Decision 2's compromise signal).
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL while active; set once revoked (explicit device sign-out, or
  -- reuse-detected auto-revocation). The row is kept, not deleted, so a
  -- reuse attempt against an already-revoked session can still be
  -- detected and logged (ADR-0022 Decision 2).
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_refresh_token_hash ON auth_sessions(refresh_token_hash);
