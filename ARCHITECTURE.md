# Operations Manager — Framework

**Repo:** `ops-manager` (GitHub, private)
**Owner:** Jonathan Ferrell, Cuantico Inc.
**Purpose:** Autonomous service that operates the Cuantico bot fleet and account portfolio on behalf of the team. Event-driven first, chat-driven second. Slack is the human surface, Postgres is memory, LiteLLM is the model router.

---

## 1. Mission

Remove Jonathan from day-to-day fleet operations across 60+ client accounts (GHL, Assistable, n8n) while preserving:

- Full audit trail of every action taken
- Human approval gates on every mutating operation in production
- Provider independence (no single-vendor lock for LLMs)
- Scalability to 500+ accounts without architectural rewrite

This is **not** Bot Factory. Bot Factory builds and deploys bots. Operations Manager runs the fleet *after* deployment.

---

## 2. Scope boundaries

### In scope (v1 through v3)
- GHL fleet visibility and operations
- Assistable account health and OAuth management
- n8n workflow health and trigger orchestration
- Slack as primary human interface
- Audit logging of every action
- Scheduled jobs and webhook-triggered jobs
- Approval workflow for mutating operations

### Out of scope (forever, or until explicitly added)
- Customer-facing AI (that's Assistable bots)
- Bot prompt generation (that's Bot Factory)
- Direct customer communication
- Replacing GHL/Assistable/n8n — this *operates* them, doesn't replace them
- Financial operations (billing, payments) — separate service if/when needed

---

## 3. Architecture overview

```
                    ┌─────────────────────────────────────────┐
                    │            HUMAN SURFACE                │
                    │  Slack (slash cmds, approvals, alerts)  │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │           OPS MANAGER CORE              │
                    │                                         │
                    │  ┌─────────────┐    ┌──────────────┐    │
                    │  │  Scheduler  │    │  Webhooks    │    │
                    │  │  (cron)     │    │  (inbound)   │    │
                    │  └──────┬──────┘    └──────┬───────┘    │
                    │         │                  │            │
                    │         └────────┬─────────┘            │
                    │                  │                      │
                    │         ┌────────▼────────┐             │
                    │         │   Job Queue     │             │
                    │         │   (BullMQ)      │             │
                    │         └────────┬────────┘             │
                    │                  │                      │
                    │         ┌────────▼────────┐             │
                    │         │   Agents        │             │
                    │         │   (roles)       │             │
                    │         └────────┬────────┘             │
                    │                  │                      │
                    │      ┌───────────┼───────────┐          │
                    │      ▼           ▼           ▼          │
                    │   ┌─────┐    ┌─────┐    ┌─────┐         │
                    │   │Skill│    │Skill│    │Skill│         │
                    │   └──┬──┘    └──┬──┘    └──┬──┘         │
                    └──────┼──────────┼──────────┼────────────┘
                           │          │          │
              ┌────────────▼──┐  ┌────▼────┐  ┌─▼──────────┐
              │ LiteLLM Proxy │  │Postgres │  │ External   │
              │ (Claude/etc)  │  │(audit,  │  │ APIs       │
              │               │  │ state)  │  │ (GHL, etc) │
              └───────────────┘  └─────────┘  └────────────┘
```

### Key principles
1. **Skills are pure functions.** Input → action → output. No skill calls another skill directly. Agents orchestrate skills.
2. **Agents are role definitions.** Each agent has a system prompt, a set of skills it can use, and an approval policy.
3. **Jobs are units of work.** Every job has an ID, status, input, output, and audit trail. Nothing runs outside a job.
4. **Approvals are first-class.** Every mutating skill checks approval state before executing. No exceptions in production.
5. **LLM calls go through one router.** LiteLLM proxy. Never direct SDK calls to Anthropic/OpenAI from skill code.

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS + TypeScript | Type safety, ecosystem, you already use it |
| Framework | Fastify | Faster than Express, better TS support |
| Database | Postgres 16 | ACID, JSON support, audit-friendly |
| Queue | BullMQ on Redis | Lightweight, mature, retry semantics |
| LLM Router | LiteLLM (self-hosted) | Provider abstraction, fallback, cost tracking |
| Slack | `@slack/bolt` | Official SDK, handles signing/events |
| Logging | Pino + Postgres audit table | Structured logs + queryable audit |
| Testing | Vitest | Faster than Jest, native ESM |
| Deploy | Docker Compose on DO droplet | Matches your existing infra |
| CI | GitHub Actions | Built into where the repo lives |
| Secrets (v1) | `.env` file, gitignored | Pragmatic start |
| Secrets (v2) | Doppler or Infisical | Migrate when you have >1 environment |

---

## 5. Repo structure

```
ops-manager/
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Lint, type-check, test on PR
│       └── deploy.yml              # Deploy to droplet on main merge
├── src/
│   ├── server.ts                   # Entry point
│   ├── agents/                     # Agent definitions
│   │   ├── _base.ts                # Base agent class
│   │   ├── ghl-ops/
│   │   │   ├── index.ts            # Agent definition
│   │   │   ├── prompt.md           # System prompt (versioned in Git)
│   │   │   └── skills.ts           # Skills this agent can call
│   │   ├── assistable-ops/
│   │   └── n8n-ops/
│   ├── skills/                     # Skill modules
│   │   ├── _types.ts               # Skill interface contract
│   │   ├── ghl/
│   │   │   ├── list-accounts.ts
│   │   │   ├── check-pit-token.ts
│   │   │   ├── list-pipelines.ts
│   │   │   ├── list-opportunities.ts
│   │   │   ├── list-workflows.ts
│   │   │   ├── list-custom-fields.ts
│   │   │   ├── get-custom-values.ts
│   │   │   └── set-custom-value.ts        # mutates: true
│   │   ├── assistable/
│   │   │   ├── list-subaccounts.ts
│   │   │   ├── check-oauth-status.ts
│   │   │   └── refresh-oauth.ts            # mutates: true
│   │   ├── n8n/
│   │   │   ├── list-workflows.ts
│   │   │   ├── check-workflow-health.ts
│   │   │   └── trigger-workflow.ts         # mutates: true
│   │   └── slack/
│   │       ├── post-message.ts
│   │       ├── request-approval.ts
│   │       └── post-thread.ts
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts           # Postgres pool
│   │   │   └── migrate.ts          # Migration runner
│   │   ├── queue/
│   │   │   ├── client.ts           # BullMQ setup
│   │   │   └── workers.ts          # Worker registration
│   │   ├── llm/
│   │   │   └── client.ts           # LiteLLM wrapper
│   │   ├── audit/
│   │   │   └── log.ts              # Audit writer
│   │   ├── approval/
│   │   │   ├── gate.ts             # The gate function
│   │   │   └── slack-flow.ts       # Approval request via Slack
│   │   └── accounts/
│   │       └── registry.ts         # Account roster sync
│   ├── jobs/                       # Scheduled jobs
│   │   ├── _registry.ts            # Job registration
│   │   ├── daily-account-health.ts
│   │   ├── weekly-pipeline-snapshot.ts
│   │   └── hourly-workflow-health.ts
│   ├── webhooks/                   # Inbound handlers
│   │   ├── ghl.ts
│   │   ├── assistable.ts
│   │   └── n8n.ts
│   └── slack/
│       ├── commands.ts             # Slash command handlers
│       ├── actions.ts              # Button click handlers
│       └── bot.ts                  # Bolt app setup
├── migrations/                     # SQL migrations, numbered
│   ├── 001_initial.sql
│   ├── 002_audit_log.sql
│   ├── 003_approvals.sql
│   └── 004_accounts.sql
├── prompts/                        # Agent prompts (mirrored in src/agents/*/prompt.md for runtime)
│   └── README.md                   # Prompt versioning policy
├── tests/
│   ├── skills/
│   ├── agents/
│   └── integration/
├── scripts/
│   ├── seed-accounts.ts            # One-time roster import
│   └── deploy.sh                   # Droplet deploy script
├── docker-compose.yml              # Local dev: app + postgres + redis + litellm
├── Dockerfile                      # Production image
├── litellm-config.yaml             # Model routing config
├── .env.example
├── .gitignore
├── .nvmrc                          # Node version pin
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md                       # Quick start + ops runbook
├── ARCHITECTURE.md                 # This document (or link to it)
└── CHANGELOG.md
```

---

## 6. Data model

### `accounts`
The source-of-truth for every Cuantico client account across all platforms.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | Display name |
| ghl_location_id | text | nullable |
| ghl_pit_token_ref | text | reference to secret, not the token itself |
| assistable_subaccount_id | text | nullable |
| n8n_workflow_ids | text[] | array of workflow IDs owned by this account |
| status | text | active, paused, churned |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| metadata | jsonb | freeform per-account config |

### `agents`
Registered agent roles.

| Column | Type | Notes |
|---|---|---|
| id | text | PK, e.g. `ghl-ops`, `assistable-ops` |
| display_name | text | |
| system_prompt_version | text | Git SHA of prompt file |
| skills | text[] | skill IDs this agent can call |
| enabled | bool | kill switch |
| approval_policy | jsonb | which actions need approval, who can approve |

### `jobs`
Every unit of work.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| agent_id | text | FK → agents |
| trigger_type | text | scheduled, webhook, slack, manual |
| trigger_payload | jsonb | original trigger data |
| status | text | pending, running, awaiting_approval, succeeded, failed, cancelled |
| input | jsonb | normalized job input |
| output | jsonb | final result |
| error | jsonb | error details if failed |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| account_id | uuid | nullable, FK → accounts |

### `audit_log`
Immutable record of every action. Append-only. Never updated, never deleted.

| Column | Type | Notes |
|---|---|---|
| id | bigserial | PK |
| job_id | uuid | FK → jobs |
| timestamp | timestamptz | |
| actor | text | agent ID or `human:<slack_user_id>` |
| action | text | skill name or system action |
| target | text | what was acted on (account id, workflow id, etc.) |
| mutated | bool | was this a state-changing action |
| input | jsonb | what was passed in |
| output | jsonb | what came back |
| approval_id | uuid | nullable, FK → approvals if gated |

### `approvals`
Pending and resolved approval requests.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| job_id | uuid | FK → jobs |
| skill | text | which skill needs approval |
| target_summary | text | human-readable description |
| proposed_action | jsonb | exact action to be taken if approved |
| status | text | pending, approved, rejected, expired |
| requested_at | timestamptz | |
| resolved_at | timestamptz | |
| resolved_by | text | Slack user ID |
| slack_message_ts | text | for updating the original Slack message |
| expires_at | timestamptz | auto-expire after N hours |

---

## 7. Skill contract

Every skill implements the same interface:

```typescript
interface Skill<Input, Output> {
  id: string;                       // unique skill ID
  description: string;              // for LLM tool description
  mutates: boolean;                 // true = requires approval gate in prod
  requiresApproval: boolean;        // can be true even for read-only (e.g. expensive ops)
  schema: ZodSchema<Input>;         // input validation
  execute(input: Input, ctx: SkillContext): Promise<Output>;
}

interface SkillContext {
  jobId: string;
  agentId: string;
  accountId?: string;
  audit: AuditLogger;
  approval: ApprovalGate;
  llm: LiteLLMClient;
}
```

Rules:
- A skill must call `ctx.audit.log()` before and after its main action
- A mutating skill must call `await ctx.approval.gate(...)` before executing the mutation
- A skill must not call another skill directly — agents orchestrate

---

## 8. The four phases

### Phase 1 — Chassis (tonight, 2–4 hours)
**Deliverable:** Repo exists, deploys to droplet, single end-to-end test passes.

- [ ] `git init`, push to private GitHub repo `ops-manager`
- [ ] Scaffold directory structure per Section 5
- [ ] `package.json`, `tsconfig.json`, `.nvmrc`, `.gitignore`, `.env.example`
- [ ] Docker Compose: Postgres + Redis + LiteLLM + app
- [ ] Migrations 001–004 written and runnable
- [ ] LiteLLM config with Anthropic primary (Bedrock stubbed in comments)
- [ ] Slack bolt app skeleton with `/ops ping` slash command
- [ ] Audit log writer that actually writes
- [ ] One smoke-test skill: `slack.post-message` (no integrations, no LLM)
- [ ] One smoke-test job: scheduled cron that posts "ops manager alive" to Slack every hour
- [ ] CI workflow: lint + type-check + test on PR
- [ ] README with local dev quickstart and deploy steps

**Acceptance:** Cron fires, audit log records it, Slack message appears, you can query Postgres and see the job record.

### Phase 2 — GHL Visibility (this week)
**Deliverable:** `ghl-ops` agent with full read-only visibility across all accounts.

Four sub-skills, built in this order:

1. **`ghl.list-accounts`** — pulls account roster, syncs `accounts` table. Foundation for everything else.
2. **`ghl.check-pit-token`** — for each account, validates PIT token, flags expired/invalid. Daily scheduled job, Slack summary post.
3. **`ghl.list-pipelines` + `ghl.list-opportunities`** — pipeline snapshot per account. Weekly scheduled job, Slack thread with summary + per-account detail.
4. **`ghl.list-workflows` + `ghl.list-custom-fields`** — workflow and custom field inventory per account. Monthly snapshot, used for drift detection.

**Acceptance:** Slack receives a daily "GHL health" post listing every account, token status, last activity. You can ask in Slack `/ops ghl-snapshot <account-name>` and get a full per-account report within 30 seconds.

### Phase 3 — Cross-platform health (next 2 weeks)
**Deliverable:** `assistable-ops` and `n8n-ops` agents.

- Assistable OAuth status check across all 58 sub-accounts (the Excel tracker becomes obsolete)
- n8n workflow health check (active, last run, error rate) across all client workflows on n8n.voyze.ai
- Unified daily health post: GHL + Assistable + n8n in one Slack thread

### Phase 4 — Mutating operations with approval gates (next 30–60 days)
**Deliverable:** First mutating skills, gated by Slack approval.

- `assistable.refresh-oauth` — refresh OAuth tokens for stale accounts (approval required for external accounts)
- `ghl.set-custom-value` — write GHL custom values (e.g. Live Event Automation slot assignment)
- `n8n.trigger-workflow` — fire n8n workflows on demand

After Phase 4, the Ops Manager is doing real work. Phases 5+ are role expansion (Prompt Ops, QA Review, Client Check-in).

---

## 9. Security baseline (non-negotiable)

1. **Read-only by default.** A skill must explicitly opt in to mutation via `mutates: true`.
2. **Production write actions require Slack approval.** No bypass, even for Jonathan. Dev environment can skip with `BYPASS_APPROVAL=true` env var, never set in prod.
3. **Service credentials, not personal credentials.** Create dedicated service accounts/PIT tokens for the Ops Manager wherever possible. Never check tokens into Git.
4. **Audit log is immutable.** Postgres role for the app can `INSERT` and `SELECT` on `audit_log` only. No `UPDATE` or `DELETE` permissions.
5. **Secrets in `.env` file for v1, vault for v2.** Migrate when you add a second environment (staging) or a second person with access.
6. **Slack approval messages include full action details.** No "approve this thing" buttons without showing exactly what's being approved.
7. **Approvals expire.** Default 4 hours. If not approved in that window, the job auto-cancels and re-requests.
8. **No agency-wide tokens.** Per-account tokens where the platform supports it.

---

## 10. LiteLLM routing config

Initial `litellm-config.yaml`:

```yaml
model_list:
  - model_name: ops-claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-5
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: ops-claude-haiku
    litellm_params:
      model: anthropic/claude-haiku-4-5
      api_key: os.environ/ANTHROPIC_API_KEY

  # Stubbed for Phase 4 — Bedrock fallback
  # - model_name: ops-claude-sonnet-bedrock
  #   litellm_params:
  #     model: bedrock/anthropic.claude-sonnet-4-5
  #     aws_region_name: us-east-1

router_settings:
  routing_strategy: simple-shuffle
  num_retries: 2
  timeout: 30

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/LITELLM_DATABASE_URL  # separate DB for cost tracking
```

Agents reference models by `ops-claude-sonnet`, never `claude-sonnet-4-5` directly. This is the abstraction that protects you from provider lock-in.

---

## 11. Slack surface

### Slash commands (v1)
- `/ops ping` — health check, returns "alive" + uptime
- `/ops accounts` — list all known accounts with status
- `/ops account <name>` — detail report for one account
- `/ops jobs` — list recent jobs and statuses
- `/ops approve <id>` — approve a pending approval (alternative to button click)

### Channels (recommended structure in Cuantico Slack)
- `#ops-manager-alerts` — auto-posts of failures, expired tokens, stale workflows
- `#ops-manager-approvals` — pending approval requests
- `#ops-manager-daily` — scheduled daily health summary
- `#ops-manager-audit` — chatty channel of every action (mutable=true only, optional)

---

## 12. What "done" looks like for v1

After Phase 2, you can answer these questions from Slack without opening a browser:

- "Which of my 60+ accounts have expired GHL tokens?"
- "What's the opportunity count by stage for Complete Lending right now?"
- "Which accounts haven't had any workflow activity in the last 7 days?"
- "Show me every custom field that exists across all GHL locations."

After Phase 3:
- "Which Assistable sub-accounts are disconnected?"
- "Which n8n workflows are failing or haven't run in 24 hours?"
- "Daily health summary for the entire fleet."

After Phase 4:
- "Refresh the OAuth tokens for these 6 accounts" → approve in Slack → done.
- "Set the Wednesday live event slot to 'in use' for Bill Rookstool's account" → approve → done.

---

## 13. What this document is

This is the source of truth for the Operations Manager architecture. It lives at `ARCHITECTURE.md` in the repo root. Every PR that changes the architecture updates this document. Skills, agents, and phases are defined here before they are built.

If a future change conflicts with what's written here, either the change is wrong or the document needs to be updated *before* the code.
