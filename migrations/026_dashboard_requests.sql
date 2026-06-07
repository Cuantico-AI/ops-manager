-- Client Requests / Work Queue (dashboard Zone B).
-- The June 2026 architecture review's endgame is autonomous client-request
-- triage; that is conceptually distinct from internal `jobs`, so requests get
-- their own first-class table that the read API and dashboard render directly.

CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',        -- new | triaging | awaiting | progress | done
  channel TEXT NOT NULL DEFAULT 'human',     -- auto | system | human | rule
  priority TEXT NOT NULL DEFAULT 'med',      -- high | med | low
  approval_id UUID REFERENCES approvals (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status);
CREATE INDEX IF NOT EXISTS idx_requests_account_id ON requests (account_id);
CREATE INDEX IF NOT EXISTS idx_requests_updated_at ON requests (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_approval_id ON requests (approval_id);

GRANT SELECT, INSERT, UPDATE ON requests TO ops_app;
