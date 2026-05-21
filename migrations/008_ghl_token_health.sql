ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ghl_token_status TEXT,
  ADD COLUMN IF NOT EXISTS ghl_token_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_accounts_ghl_token_status ON accounts (ghl_token_status);
CREATE INDEX IF NOT EXISTS idx_accounts_ghl_token_checked_at ON accounts (ghl_token_checked_at DESC);

