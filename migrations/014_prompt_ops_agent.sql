INSERT INTO agents (id, display_name, system_prompt_version, skills, enabled)
VALUES (
  'prompt-ops',
  'Prompt Ops',
  'phase-5-slice-3b',
  ARRAY['prompt-ops.review-request']::TEXT[],
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt_version = EXCLUDED.system_prompt_version,
  skills = EXCLUDED.skills,
  enabled = EXCLUDED.enabled;
