-- Phase 2.7: Live Integration Providers. Adds a non-secret expiry timestamp
-- to workspace_integrations so the API can surface "token expiration" to a
-- client without ever decrypting the credentials themselves. The token
-- material itself (access/refresh tokens) continues to live only in the
-- encrypted integration_credentials table.
ALTER TABLE workspace_integrations ADD COLUMN token_expires_at TIMESTAMPTZ;
