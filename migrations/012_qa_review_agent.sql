INSERT INTO agents (id, display_name, system_prompt_version, skills, enabled)
VALUES (
  'qa-review',
  'QA Review',
  'phase-5-slice-1',
  ARRAY['qa.review-transcript']::TEXT[],
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt_version = EXCLUDED.system_prompt_version,
  skills = EXCLUDED.skills,
  enabled = EXCLUDED.enabled;
