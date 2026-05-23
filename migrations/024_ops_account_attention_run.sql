UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-13',
  skills = ARRAY[
    'ops.fleet-digest',
    'ops.account-digest',
    'ops.account-attention-run'
  ]::TEXT[]
WHERE id = 'ops-digest';
