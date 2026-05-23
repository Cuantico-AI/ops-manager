# Operations Manager

Autonomous fleet operations service for Cuantico Inc. — event-driven ops across GHL, Assistable, and n8n with Slack as the human surface. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full framework. Phase 2 scope: [docs/phases/PHASE-2.md](./docs/phases/PHASE-2.md).

## Local dev quickstart

> **Local dev only.** This laptop `docker compose` stack is for development. The canonical/production deployment runs on the DigitalOcean droplet — see [Deploy](#deploy).

1. Clone the repo and install Node 20 (`nvm use`).
2. Copy env template and fill in Slack + Anthropic keys:

   ```bash
   cp .env.example .env
   ```

   Required for a full run: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` (Socket Mode), `ANTHROPIC_API_KEY`.

3. Start the stack:

   ```bash
   docker compose up --build
   ```

   - App HTTP: http://localhost:3100 (maps to container port 3000)
   - Postgres, Redis, and LiteLLM start automatically; migrations run on app startup.

## Verify it works

**Health endpoint**

```bash
curl http://localhost:3100/health
```

Expected: `{"status":"ok","uptime":...,"version":"0.1.0"}`

**Slack**

- Invite the bot to `#ops-manager-alerts`.
- Run `/ops ping` in Slack → `pong — uptime: Ns`.
- Wait for the hourly heartbeat (or set `HEARTBEAT_CRON=*/5 * * * *` in `.env` for faster local testing).

**Postgres**

```bash
docker compose exec postgres psql -U ops -d opsmanager -c \
  "SELECT id, action, actor, timestamp FROM audit_log ORDER BY id DESC LIMIT 5;"

docker compose exec postgres psql -U ops -d opsmanager -c \
  "SELECT id, status, agent_id, started_at, completed_at FROM jobs ORDER BY started_at DESC LIMIT 5;"
```

## Run tests

With Postgres and Redis running locally (or via `docker compose up postgres redis -d`):

```bash
export DATABASE_ADMIN_URL=postgres://ops:dev_admin_password@127.0.0.1:5432/opsmanager
export DATABASE_URL=postgres://ops_app:dev_password@127.0.0.1:5432/opsmanager
export REDIS_URL=redis://127.0.0.1:6379
npm ci
npm run migrate
npm test
```

## Add a new skill

1. Create `src/skills/<domain>/<name>.ts` implementing the `Skill` interface from `src/skills/_types.ts`.
2. Set `id`, `mutates`, `requiresApproval`, Zod `schema`, and `execute()` (audit before/after; call `ctx.approval.gate()` if mutating).
3. Register in `src/server.ts` via `registry.register(...)`.
4. Add tests under `tests/skills/`.

## Phase 2 roster sync

`ghl.list-accounts` can sync the account roster from Google Sheets. If the Sheet
contains PIT tokens, keep it private and use the service-account env vars documented in
[docs/phases/PHASE-2.md](./docs/phases/PHASE-2.md). Do not publish or paste a
token-bearing Sheet URL; public CSV URLs are only appropriate for tokenless rosters.
After deployment, run `/ops sync-roster` in Slack to sync the Sheet, then `/ops accounts`
to view token-present/token-missing status.
Run `/ops check-tokens` to validate stored GHL PIT tokens against LeadConnector; the
daily scheduled check uses `GHL_TOKEN_HEALTH_CRON`. To diagnose one account, pass a
name: `/ops check-tokens Annie Stern`.
Run `/ops ghl-snapshot Complete Lending` for a per-account pipeline/opportunity report.
The weekly fleet summary runs on `GHL_PIPELINE_SNAPSHOT_CRON`.
Run `/ops ghl-inventory Complete Lending` for a per-account workflow/custom-field report.
The monthly fleet summary runs on `GHL_CONFIG_INVENTORY_CRON`.
Run `/ops check-assistable` to validate Assistable GHL OAuth connections; the daily
scheduled check uses `ASSISTABLE_OAUTH_HEALTH_CRON`. Run `/ops check-n8n` to
validate tracked client workflows on `n8n.voyze.ai`; the daily scheduled check uses
`N8N_WORKFLOW_HEALTH_CRON`. Run `/ops fleet-health` for a combined GHL + Assistable +
n8n report. When `FLEET_DAILY_HEALTH_ENABLED` is true (default), the daily scheduled
job posts one threaded summary instead of three separate alerts. Phase 3 scope:
[docs/phases/PHASE-3.md](./docs/phases/PHASE-3.md).

## Phase 4 mutating ops

Phase 4 adds write-capable skills gated by Slack approval in production. With
`BYPASS_APPROVAL=true` in local dev, mutating commands run immediately.

- `/ops set-custom-value <account> <customValueId> <value>` — update a GHL location custom value
- `/ops trigger-n8n <account> [workflowId]` — trigger a tracked n8n workflow
- `/ops refresh-assistable <account>` — re-check Assistable OAuth and show manual reconnect steps (API refresh only when `ASSISTABLE_REFRESH_OAUTH_PATH` is set)
- `/ops approve <approval-id>` — approve a pending mutating action
- `/ops reject <approval-id>` — reject a pending mutating action
- `/ops jobs` — list recent jobs and statuses

Pending approvals post to `SLACK_APPROVALS_CHANNEL` (default `#ops-manager-approvals`)
with Approve/Reject buttons. Phase 4 scope: [docs/phases/PHASE-4.md](./docs/phases/PHASE-4.md).

## Phase 5 agent roles

Phase 5 adds LLM-powered agent roles. Slice 1 is **QA Review**:

- `/ops qa-review <account> :: <transcript>` — structured QA score + findings for a pasted call/chat transcript
- `/ops qa-history <account> [limit]` — recent persisted QA reviews for an account
- `/ops qa-failures <account> [limit]` — recent failed QA reviews for an account
- `/ops qa-show <call_id>` — persisted QA review for an Assistable call ID
- Jobs run as `agent_id = qa-review` with audit trail (transcript content is not stored in audit logs)
- `/ops client-checkin <account>` — pre-call client brief from stored GHL, Assistable, and n8n health signals
- Client check-ins run as `agent_id = client-checkin` and do not mutate external systems
- `/ops prompt-ops <account> :: <prompt change request>` — read-only prompt change risk/review brief
- Prompt Ops runs as `agent_id = prompt-ops`; it does not update live assistant prompts or external systems

Requires LiteLLM + `ANTHROPIC_API_KEY`. Optional model overrides include
`CLIENT_CHECKIN_MODEL` and `PROMPT_OPS_MODEL`; both default to `ops-claude-sonnet`.
Phase 5 scope: [docs/phases/PHASE-5.md](./docs/phases/PHASE-5.md).

**Auto QA (slice 2):** point Assistable post-call webhooks at `POST /webhooks/assistable/post-call` and set `QA_AUTO_REVIEW_ENABLED=true`. Reviews are stored on job records; Slack alerts are **off by default** (set `QA_REVIEW_SLACK_ENABLED=true` only if you want them). See Phase 5 doc for env vars.

## Deploy

**Canonical deployment:** the DigitalOcean droplet at **`147.182.131.74`**, repo checked out at **`/opt/ops-manager`** (tracks `main`). The laptop `docker compose` stack [above](#local-dev-quickstart) is **local dev only** — this droplet is the source of truth for running ops-manager.

Deploy is pull-to-deploy:

```bash
ssh -i ~/.ssh/ops_manager_droplet root@147.182.131.74
cd /opt/ops-manager
git pull origin main
docker compose up -d --build      # rebuilds app; migrations run on app boot
```

[scripts/deploy.sh](./scripts/deploy.sh) wraps SSH + pull + build + health check (set `DROPLET_IP` / `SSH_KEY` / `DEPLOY_PATH`). App listens on host port **3100** → container **3000**.

**First-time setup on a fresh droplet:** `.env` is gitignored, so `git pull` never delivers it. Generate it on the droplet with [scripts/scaffold-env.sh](./scripts/scaffold-env.sh), which renders [scripts/env.template](./scripts/env.template) with fresh `openssl`-generated DB + LiteLLM secrets (written `0600 root:root`) and leaves `REPLACE_ME_*` placeholders for `ANTHROPIC_API_KEY` and the `SLACK_*` tokens to fill in by hand:

```bash
cd /opt/ops-manager && bash scripts/scaffold-env.sh   # writes /opt/ops-manager/.env
```

For production Postgres you can instead point `DATABASE_URL` at a DO managed cluster (e.g. `db-postgresql-nyc1-84612`) — no code changes required; the current droplet runs the containerized Postgres from `docker-compose.yml`.

## Production notes

- **Socket Mode** in Phase 1; switch to Events API when adding inbound webhooks.
- Never set `BYPASS_APPROVAL=true` in production.
- `ops_app` role has INSERT+SELECT only on `audit_log` (immutable audit trail).
