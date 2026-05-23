UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-12',
  skills = ARRAY[
    'ops.fleet-digest',
    'ops.account-digest'
  ]::TEXT[]
WHERE id = 'ops-digest';
