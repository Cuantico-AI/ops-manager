UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-7',
  skills = ARRAY[
    'qa.review-transcript',
    'qa.list-reviews',
    'qa.get-review',
    'qa.list-fleet-failures'
  ]::TEXT[]
WHERE id = 'qa-review';
