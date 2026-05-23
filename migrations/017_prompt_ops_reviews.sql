CREATE TABLE IF NOT EXISTS prompt_ops_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  summary TEXT NOT NULL,
  intended_outcome TEXT NOT NULL,
  recommended_changes JSONB NOT NULL DEFAULT '[]'::JSONB,
  test_plan JSONB NOT NULL DEFAULT '[]'::JSONB,
  rollback_plan JSONB NOT NULL DEFAULT '[]'::JSONB,
  clarifying_questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  blockers JSONB NOT NULL DEFAULT '[]'::JSONB,
  model_used TEXT NOT NULL,
  request_chars INTEGER NOT NULL DEFAULT 0 CHECK (request_chars >= 0),
  current_prompt_chars INTEGER NOT NULL DEFAULT 0 CHECK (current_prompt_chars >= 0),
  conversation_sample_chars INTEGER NOT NULL DEFAULT 0 CHECK (conversation_sample_chars >= 0),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_ops_reviews_account_reviewed_at
  ON prompt_ops_reviews (account_id, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_ops_reviews_blocked_reviewed_at
  ON prompt_ops_reviews (blocked, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_ops_reviews_job_id
  ON prompt_ops_reviews (job_id);

UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-6',
  skills = ARRAY[
    'prompt-ops.review-request',
    'prompt-ops.list-reviews',
    'prompt-ops.get-review'
  ]::TEXT[]
WHERE id = 'prompt-ops';

GRANT SELECT, INSERT ON prompt_ops_reviews TO ops_app;
