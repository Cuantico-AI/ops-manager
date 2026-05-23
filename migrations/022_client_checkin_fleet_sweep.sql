UPDATE agents
SET
  system_prompt_version = 'phase-5-slice-11',
  skills = ARRAY[
    'client-checkin.generate-brief',
    'client-checkin.list-briefs',
    'client-checkin.get-brief',
    'client-checkin.list-fleet-risks'
  ]::TEXT[]
WHERE id = 'client-checkin';
