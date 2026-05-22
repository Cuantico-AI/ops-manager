ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS assistable_oauth_status TEXT,
  ADD COLUMN IF NOT EXISTS assistable_oauth_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_accounts_assistable_oauth_status ON accounts (assistable_oauth_status);
CREATE INDEX IF NOT EXISTS idx_accounts_assistable_oauth_checked_at
  ON accounts (assistable_oauth_checked_at DESC);
