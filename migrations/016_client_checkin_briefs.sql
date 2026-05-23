CREATE TABLE IF NOT EXISTS client_checkin_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'watch', 'at_risk')),
  summary TEXT NOT NULL,
  talking_points JSONB NOT NULL DEFAULT '[]'::JSONB,
  open_issues JSONB NOT NULL DEFAULT '[]'::JSONB,
  follow_up_questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  signals JSONB NOT NULL DEFAULT '{}'::JSONB,
  model_used TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_checkin_briefs_account_generated_at
  ON client_checkin_briefs (account_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_checkin_briefs_status_generated_at
  ON client_checkin_briefs (status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_checkin_briefs_job_id
  ON client_checkin_briefs (job_id);

UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-5',
  skills = ARRAY[
    'client-checkin.generate-brief',
    'client-checkin.list-briefs',
    'client-checkin.get-brief'
  ]::TEXT[]
WHERE id = 'client-checkin';

GRANT SELECT, INSERT ON client_checkin_briefs TO ops_app;
