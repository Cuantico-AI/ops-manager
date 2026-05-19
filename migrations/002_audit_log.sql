-- App role (login used by DATABASE_URL at runtime)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ops_app') THEN
    CREATE ROLE ops_app WITH LOGIN PASSWORD 'dev_password';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  mutated BOOLEAN NOT NULL DEFAULT FALSE,
  input JSONB,
  output JSONB,
  approval_id UUID
);

CREATE INDEX IF NOT EXISTS idx_audit_log_job_id ON audit_log (job_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC);

GRANT CONNECT ON DATABASE opsmanager TO ops_app;
GRANT USAGE ON SCHEMA public TO ops_app;
GRANT SELECT, INSERT ON audit_log TO ops_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO ops_app;

-- Immutable audit: no UPDATE or DELETE for ops_app
REVOKE UPDATE, DELETE ON audit_log FROM ops_app;
