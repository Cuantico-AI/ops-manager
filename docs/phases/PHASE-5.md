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

## Slice 2 (next)

- Fetch recent call transcripts from Assistable API (when endpoint is confirmed)
- Optional scheduled batch QA for flagged accounts

## Slice 3 (next)

- Client Check-in agent role
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
```
