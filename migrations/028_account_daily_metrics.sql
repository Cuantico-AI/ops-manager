-- Materialized per-account daily rollups backing two dashboard time-series that
-- were previously faked in postgres mode: the fleet/account activity sparkline
-- (runs per day, from jobs) and the QA daily trend (avg review score per day,
-- from qa_reviews). Populated by the deterministic `account-rollups` BullMQ job
-- (same input -> same output, no agent). Reads are cheap; the dashboard never
-- aggregates these on the hot path.
CREATE TABLE IF NOT EXISTS account_daily_metrics (
  account_id     UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  day            DATE NOT NULL,
  activity_count INTEGER NOT NULL DEFAULT 0,
  qa_avg_score   INTEGER,
  PRIMARY KEY (account_id, day)
);

CREATE INDEX IF NOT EXISTS idx_account_daily_metrics_day
  ON account_daily_metrics (day DESC);

-- App role reads the rollup and the rollup job rewrites a trailing window
-- (DELETE + INSERT) on every run, so it needs full DML here. This is not
-- audit_log — mutability is expected.
GRANT SELECT, INSERT, UPDATE, DELETE ON account_daily_metrics TO ops_app;
