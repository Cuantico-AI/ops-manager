CREATE TABLE IF NOT EXISTS qa_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  call_id TEXT,
  review_trigger TEXT NOT NULL DEFAULT 'manual',
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  pass BOOLEAN NOT NULL,
  call_type TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::JSONB,
  model_used TEXT NOT NULL,
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  transcript_chars INTEGER NOT NULL DEFAULT 0 CHECK (transcript_chars >= 0),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_reviews_account_reviewed_at
  ON qa_reviews (account_id, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_qa_reviews_pass_reviewed_at
  ON qa_reviews (pass, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_qa_reviews_job_id
  ON qa_reviews (job_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_reviews_call_id_unique
  ON qa_reviews (call_id)
  WHERE call_id IS NOT NULL;

UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-4',
  skills = ARRAY['qa.review-transcript', 'qa.list-reviews', 'qa.get-review']::TEXT[]
WHERE id = 'qa-review';

GRANT SELECT, INSERT, UPDATE ON qa_reviews TO ops_app;
