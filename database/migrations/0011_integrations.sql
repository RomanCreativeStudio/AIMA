-- External Integrations Foundation (Phase 2.3): per-workspace connection
-- status for the three read-only connectors (Gmail, GitHub, Calendar) plus
-- their encrypted credentials, kept in a separate table so the secret
-- material has its own lifecycle (deleted outright on disconnect, replaced
-- wholesale on rotation) rather than being a nullable column on the status
-- row itself (docs/decisions/0011-external-integrations-foundation.md).
CREATE TYPE integration_provider AS ENUM ('gmail', 'github', 'calendar');
CREATE TYPE integration_status AS ENUM ('disconnected', 'connected', 'error');

CREATE TABLE workspace_integrations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider           integration_provider NOT NULL,
  enabled            BOOLEAN NOT NULL DEFAULT false,
  status             integration_status NOT NULL DEFAULT 'disconnected',
  connected_at       TIMESTAMPTZ,
  last_validated_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE INDEX idx_workspace_integrations_workspace ON workspace_integrations(workspace_id);

CREATE TABLE integration_credentials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id     UUID NOT NULL UNIQUE REFERENCES workspace_integrations(id) ON DELETE CASCADE,
  encrypted_payload  TEXT NOT NULL,
  iv                 TEXT NOT NULL,
  auth_tag           TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at         TIMESTAMPTZ
);
