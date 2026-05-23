# Phase 5 — Agent roles

Phase 5 adds LLM-orchestrated agent roles that call existing skills. The first role is
**QA Review** — structured call/chat transcript review for fleet quality assurance.

## Security rules

1. QA Review skills are read-only (`mutates: false`) and do not require approval.
2. Transcript content is sent to LiteLLM (Anthropic via proxy). Do not paste PCI/PHI
   beyond what is already acceptable in your QA workflow.
3. Audit logs store transcript length and finding counts, not full transcript text.
4. Job output JSON includes the full structured review for operator retrieval via `/ops jobs`.

## Slice 1 (this PR) — QA Review

- Seed `qa-review` agent row in Postgres
- `qa.review-transcript` — LLM-scored transcript review with structured findings
- `/ops qa-review <account> :: <transcript>`

### Usage

```
/ops qa-review Ron Jones - AFLAC Recruiting System :: Agent: Hi, this is...
Customer: Hello...
```

The ` :: ` delimiter separates account name from transcript text.

### Review output

Each review returns:

| Field | Meaning |
| --- | --- |
| `score` | 0–100 quality score |
| `pass` | Whether the interaction meets minimum QA bar |
| `summary` | Short narrative summary |
| `findings[]` | Structured issues with severity, category, detail, optional quote |

### Limitations (slice 1)

- Operator must paste the transcript manually (no Assistable/GHL fetch yet)
- Single-turn LLM call (no tool-calling agent loop)
- Results stored on the job record only (no dedicated `qa_reviews` table)

## Slice 2 (this PR) — Auto QA from Assistable post-call webhooks

Policy (designed for ~1M calls/month):

| Rule | Default |
| --- | --- |
| Auto QA model | Haiku (`QA_AUTO_REVIEW_MODEL=ops-claude-haiku`) |
| Escalation model | Sonnet on Haiku FAIL (`QA_REVIEW_ESCALATION_MODEL=ops-claude-sonnet`) |
| Random sample | 1.5% of eligible calls (`QA_REVIEW_SAMPLE_RATE=0.015`) |
| Always review | Negative sentiment, negative tags, `ai_call_error_*` tags, failed task completion |
| Skip | Under 90s, voicemail/machine/no-answer/busy tags, missing transcript/location |
| Slack alerts | Off by default; optional (`QA_REVIEW_SLACK_ENABLED=true`, mode `escalation`) |

Webhook endpoint:

```
POST https://<ops-manager-host>/webhooks/assistable/post-call
Header: X-Ops-Webhook-Secret: <ASSISTABLE_POST_CALL_WEBHOOK_SECRET>
```

Assistable/GHL post-call workflows must include `location_id`, `call_id`, `full_transcript`,
`call_time_seconds`, `user_sentiment`, and optional `tags` / `contact_tags`.

Set `QA_AUTO_REVIEW_ENABLED=true` on the droplet after wiring the webhook.

## Slice 3a (this PR) — Client Check-in

- Seed `client-checkin` agent row in Postgres
- `client-checkin.generate-brief` — LLM-generated client brief from stored account health signals
- `/ops client-checkin <account>` (alias `/ops check-in`)

### Usage

```
/ops client-checkin Complete Lending
```

The first slice uses the latest stored GHL PIT, Assistable OAuth, and n8n workflow
health fields on the account record. It does not call external APIs directly, mutate
client systems, schedule recurring check-ins, or write a dedicated check-in table.

## Slice 3b (next)

- Prompt Ops agent role

## Required env vars

Uses the existing LiteLLM stack:

```
LITELLM_PROXY_URL=http://litellm:4000
LITELLM_MASTER_KEY=
ANTHROPIC_API_KEY=
# Optional:
# QA_REVIEW_MODEL=ops-claude-sonnet
# QA_REVIEW_MAX_TRANSCRIPT_CHARS=50000
# CLIENT_CHECKIN_MODEL=ops-claude-sonnet

# Phase 5 slice 2 — auto QA from Assistable post-call webhooks
# QA_AUTO_REVIEW_ENABLED=true
# ASSISTABLE_POST_CALL_WEBHOOK_SECRET=
# QA_AUTO_REVIEW_MODEL=ops-claude-haiku
# QA_REVIEW_ESCALATION_MODEL=ops-claude-sonnet
# QA_REVIEW_SAMPLE_RATE=0.015
# QA_REVIEW_MIN_DURATION_SEC=90
# QA_REVIEW_MIN_TRANSCRIPT_CHARS=200
# QA_REVIEW_NEGATIVE_SENTIMENTS=negative
# QA_REVIEW_ALWAYS_TAGS=negative
# QA_REVIEW_SKIP_TAGS=voicemail reached,machine detected,not answered,dial no answer,dial busy,dial failed
# QA_REVIEW_SLACK_ENABLED=false
# QA_REVIEW_SLACK_MODE=escalation
# QA_REVIEW_SLACK_CHANNEL=#ops-manager-alerts
```
