UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-9',
  skills = ARRAY[
    'prompt-ops.review-request',
    'prompt-ops.list-reviews',
    'prompt-ops.get-review',
    'prompt-ops.list-fleet-risks'
  ]::TEXT[]
WHERE id = 'prompt-ops';
