# Operations Manager

Autonomous fleet operations service for Cuantico Inc. — event-driven ops across GHL, Assistable, and n8n with Slack as the human surface. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full framework.

## Local dev quickstart

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

## Deploy

Manual deploy script: [scripts/deploy.sh](./scripts/deploy.sh). Set `DROPLET_IP` and SSH key, then run on the n8n droplet (host port **3100**).

For production Postgres, point `DATABASE_URL` at your DO managed cluster (`db-postgresql-nyc1-84612`) — no code changes required.

## Production notes

- **Socket Mode** in Phase 1; switch to Events API when adding inbound webhooks.
- Never set `BYPASS_APPROVAL=true` in production.
- `ops_app` role has INSERT+SELECT only on `audit_log` (immutable audit trail).
