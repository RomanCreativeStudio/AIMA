-- Voice Assistant Foundation (Phase 3.2): session lifecycle for voice
-- interaction, built on top of the existing conversation/message pipeline
-- rather than a parallel one — a voice session drives a real conversation
-- via AimaCoreService, it does not reimplement orchestration
-- (docs/decisions/0017-voice-assistant-foundation.md).
--
-- No audio bytes are ever persisted here by design (this phase's explicit
-- "no audio persistence by default" requirement) — only the transcript
-- text and the generated response text for each turn.

CREATE TYPE voice_session_status AS ENUM ('active', 'ended');

CREATE TABLE voice_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Set once the session's first turn creates (or is handed) a conversation.
  -- ON DELETE SET NULL for the same reason executions.pending_approval_id
  -- uses it (0014_executions.sql): a separate cascade chain from the direct
  -- workspaces -> voice_sessions one would otherwise block a workspace
  -- delete under the default RESTRICT.
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status          voice_session_status NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  sequence        BIGSERIAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_sessions_workspace_sequence ON voice_sessions(workspace_id, sequence DESC);

CREATE TABLE voice_turns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_session_id      UUID NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transcript_text       TEXT NOT NULL,
  transcript_confidence REAL,
  response_text         TEXT NOT NULL,
  sequence              BIGSERIAL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_turns_session_sequence ON voice_turns(voice_session_id, sequence DESC);
