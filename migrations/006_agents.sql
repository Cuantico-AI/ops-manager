CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  system_prompt_version TEXT,
  skills TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  approval_policy JSONB DEFAULT '{}'
);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents (id);

INSERT INTO agents (id, display_name, system_prompt_version, skills, enabled)
VALUES ('system', 'System Chassis', 'phase-1', ARRAY[]::TEXT[], TRUE)
ON CONFLICT (id) DO NOTHING;

-- Runtime grants for ops_app (jobs updates required for heartbeat)
GRANT SELECT, INSERT, UPDATE ON jobs TO ops_app;
GRANT SELECT ON agents, accounts, approvals TO ops_app;
