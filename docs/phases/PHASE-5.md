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

The `::` delimiter separates account name from transcript text.

### Review output

Each review returns:

| Field        | Meaning                                                           |
| ------------ | ----------------------------------------------------------------- |
| `score`      | 0–100 quality score                                               |
| `pass`       | Whether the interaction meets minimum QA bar                      |
| `summary`    | Short narrative summary                                           |
| `findings[]` | Structured issues with severity, category, detail, optional quote |

### Limitations (slice 1)

- Operator must paste the transcript manually (no Assistable/GHL fetch yet)
- Single-turn LLM call (no tool-calling agent loop)
- Results stored on the job record only (no dedicated `qa_reviews` table)

## Slice 2 (this PR) — Auto QA from Assistable post-call webhooks

Policy (designed for ~1M calls/month):

| Rule             | Default                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| Auto QA model    | Haiku (`QA_AUTO_REVIEW_MODEL=ops-claude-haiku`)                                   |
| Escalation model | Sonnet on Haiku FAIL (`QA_REVIEW_ESCALATION_MODEL=ops-claude-sonnet`)             |
| Random sample    | 1.5% of eligible calls (`QA_REVIEW_SAMPLE_RATE=0.015`)                            |
| Always review    | Negative sentiment, negative tags, `ai_call_error_*` tags, failed task completion |
| Skip             | Under 90s, voicemail/machine/no-answer/busy tags, missing transcript/location     |
| Slack alerts     | Off by default; optional (`QA_REVIEW_SLACK_ENABLED=true`, mode `escalation`)      |

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

## Slice 3b (this PR) — Prompt Ops

- Seed `prompt-ops` agent row in Postgres
- `prompt-ops.review-request` — read-only LLM-generated prompt-change review brief
- `/ops prompt-ops <account> :: <prompt change request>` (aliases `/ops promptops`, `/ops prompt-review`)

### Usage

```
/ops prompt-ops Complete Lending :: tighten objection handling for callers who ask about pricing
```

This slice keeps Prompt Ops at the operational review layer. It can summarize intended
outcomes, risks, tests, rollback/monitoring steps, blockers, and clarifying questions
from pasted context, but it does not update Assistable/GHL/n8n or generate a full
deployable customer-facing assistant prompt.

## Slice 4 (this PR) — QA persistence and retrieval

- Add `qa_reviews` table for structured QA review history without storing full transcripts
- Persist manual `/ops qa-review` results and Assistable Auto QA webhook results
- Add `/ops qa-history <account> [limit]` for recent reviews
- Add `/ops qa-failures <account> [limit]` for recent failed reviews
- Add `/ops qa-show <call_id>` for a persisted Assistable call review

The persistence layer stores score, pass/fail, trigger, call ID, summary, structured
findings, model, escalation flag, transcript character count, and account/job links.
Webhook reviews are idempotent by `call_id`; retries update the same `qa_reviews`
record instead of creating duplicates. Raw transcript text remains outside the
dedicated QA table and audit logs.

## Slice 5 (this PR) — Client Check-in persistence and retrieval

- Add `client_checkin_briefs` table for generated check-in history
- Persist manual `/ops client-checkin` brief output and source health signals
- Add `/ops checkin-history <account> [limit]` for recent client briefs
- Add `/ops checkin-show <brief_id>` for a persisted brief

The persistence layer stores the generated status, summary, talking points, open
issues, follow-up questions, model, generated timestamp, and non-secret health
signals. It does not store GHL PIT tokens or Assistable credentials.

## Slice 6 (this PR) — Prompt Ops persistence and retrieval

- Add `prompt_ops_reviews` table for generated Prompt Ops review history
- Persist manual `/ops prompt-ops` review output and context character counts
- Add `/ops prompt-history <account> [limit]` for recent Prompt Ops reviews
- Add `/ops prompt-history <account> --blocked` for blocked-only review history
- Add `/ops prompt-show <review_id>` for a persisted Prompt Ops review

The persistence layer stores the risk level, blocked flag, summary, intended
outcome, recommendations, test/rollback plans, clarifying questions, blockers,
model, reviewed timestamp, and context character counts. It does not store the
raw prompt-change request, current prompt, or conversation sample text.

## Slice 7 (this PR) — Fleet QA summary

- Add read-only `qa.list-fleet-failures` skill for fleet-wide persisted QA rollups
- Add `/ops qa-fleet-summary [hours]` for recent QA pass/fail, pass rate, and top failure groups
- Add `/ops qa-fleet-failures [hours]` as an alias for operators looking for failures
- Add optional scheduled QA fleet failure posts when `QA_FLEET_SUMMARY_ENABLED=true`

The rollup reads only `qa_reviews` metadata and summaries. It does not fetch or expose
raw transcripts, finding quotes, GHL PIT tokens, Assistable credentials, or n8n secrets.
The scheduled job suppresses Slack posts when no failures exist in the configured window.

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
# PROMPT_OPS_MODEL=ops-claude-sonnet
# PROMPT_OPS_MAX_CONTEXT_CHARS=30000

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
# QA_FLEET_SUMMARY_ENABLED=false
# QA_FLEET_SUMMARY_CRON=0 15 * * *
# QA_FLEET_SUMMARY_HOURS=24
# QA_FLEET_SUMMARY_CHANNEL=#ops-manager-alerts
```
