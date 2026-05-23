INSERT INTO agents (id, display_name, system_prompt_version, skills, enabled)
VALUES (
  'ops-digest',
  'Ops Digest',
  'phase-5-slice-10',
  ARRAY['ops.fleet-digest']::TEXT[],
  TRUE
)
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  system_prompt_version = EXCLUDED.system_prompt_version,
  skills = EXCLUDED.skills,
  enabled = EXCLUDED.enabled;
