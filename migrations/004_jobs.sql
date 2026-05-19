CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  input JSONB,
  output JSONB,
  error JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  account_id UUID
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs (started_at DESC);

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES jobs (id)
  ON DELETE SET NULL;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES jobs (id)
  ON DELETE CASCADE;
