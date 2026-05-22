ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS n8n_workflow_status TEXT,
  ADD COLUMN IF NOT EXISTS n8n_workflow_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_accounts_n8n_workflow_status ON accounts (n8n_workflow_status);
CREATE INDEX IF NOT EXISTS idx_accounts_n8n_workflow_checked_at
  ON accounts (n8n_workflow_checked_at DESC);
