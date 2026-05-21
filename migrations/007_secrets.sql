CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_secrets_kind ON secrets (kind);

-- Phase 2 roster sync updates local account state and stores PIT tokens encrypted.
GRANT SELECT, INSERT, UPDATE ON accounts TO ops_app;
GRANT SELECT, INSERT, UPDATE ON secrets TO ops_app;
REVOKE DELETE ON secrets FROM ops_app;

