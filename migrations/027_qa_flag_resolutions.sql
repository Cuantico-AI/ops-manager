-- QA flag resolution state (dashboard Zone C: confirm / dismiss).
-- `qa_reviews` stores the QA agent's findings, but had no record of the human
-- decision on each flagged finding. This table captures that decision so the
-- review queue can exclude resolved flags and the decision can feed the QA
-- tuning set. Append-only from the app's perspective (SELECT, INSERT only).

CREATE TABLE IF NOT EXISTS qa_flag_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qa_review_id UUID REFERENCES qa_reviews (id) ON DELETE CASCADE,
  -- Stable identifier the dashboard uses for a flag (e.g. "<review_id>:<finding_index>").
  flag_key TEXT NOT NULL,
  finding_index INTEGER,
  decision TEXT NOT NULL,                     -- confirm | dismiss
  resolved_by TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_flag_resolutions_flag_key
  ON qa_flag_resolutions (flag_key);
CREATE INDEX IF NOT EXISTS idx_qa_flag_resolutions_review
  ON qa_flag_resolutions (qa_review_id);

GRANT SELECT, INSERT ON qa_flag_resolutions TO ops_app;
