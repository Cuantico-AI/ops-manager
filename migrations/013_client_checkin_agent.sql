INSERT INTO agents (id, display_name, system_prompt_version, skills, enabled)
VALUES (
  'client-checkin',
  'Client Check-in',
  'phase-5-slice-3a',
  ARRAY['client-checkin.generate-brief']::TEXT[],
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt_version = EXCLUDED.system_prompt_version,
  skills = EXCLUDED.skills,
  enabled = EXCLUDED.enabled;
