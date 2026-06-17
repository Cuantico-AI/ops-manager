# ops-manager — Deployment Memory

Quick-reference for the **production** deployment. For local dev see [README.md](./README.md); for the framework see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Where it runs

- **Droplet:** DigitalOcean — `147.182.131.74` (hostname `ops-manager`, Ubuntu 24.04).
- **Install path:** `/opt/ops-manager` — git clone that tracks `main`.
- **Access:** `ssh -i ~/.ssh/ops_manager_droplet root@147.182.131.74`
- **Deploy (pull-to-deploy):** `cd /opt/ops-manager && git pull origin main && docker compose up -d --build`
- **Stack:** docker compose — `postgres:16`, `redis:7-alpine`, `litellm`, and `app` (host **3100** → container **3000**). Only `app` is published; the rest are network-internal. The app runs DB migrations **and** the `ops_app` password sync on boot.
- This droplet is the **sole** source of truth. The old laptop docker-compose stack has been decommissioned (it had shared the same Slack token — see "What changed and why").

## Scaffolding `.env` on a fresh droplet

`.env` is gitignored and is **never** delivered by `git pull` — generate it on the droplet:

```bash
cd /opt/ops-manager
bash scripts/scaffold-env.sh        # renders scripts/env.template -> /opt/ops-manager/.env (0600 root:root)
```

`scaffold-env.sh` generates `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD`, and `LITELLM_MASTER_KEY` with `openssl rand -base64 32`, mapped to **base64url** so the values stay URL-safe inside the `postgres://` strings docker-compose builds from them. It refuses to overwrite an existing `.env` and never prints secrets. Then fill the four `REPLACE_ME_`* placeholders by hand (paste real values, keep mode `0600`):

- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`

## ⚠️ BYPASS_APPROVAL

The droplet `.env` sets `BYPASS_APPROVAL=false` — the Phase-4 approval gate is live and verified in both directions. Mutating skills require human approval before executing.

## Slack identity & token fingerprints

Bot identity in workspace **Cuantico AI**:

- App / bot name: `opsmanager`
- `user_id`: `U0B4SMA06UC`
- `bot_id`: `B0B4KMA69JR`
- `team_id`: `T0AHUMHAZD1`

Token fingerprints as of **2026-05-20** — SHA-256 of the token *value* (CR/LF stripped), so future-me can detect a rotation without the secrets being stored here:

- `SLACK_BOT_TOKEN`: `8668d64d20ca7fcc9da1eebd211c04e70cb022597d4d3c14d198157a4481772a`
- `SLACK_APP_TOKEN`: `bfb962a6717e68c1b3de8d4112681040121b6e866dcbd738346d6a7824ecf935`

Re-check on the droplet (a mismatch means the token was rotated):

```bash
grep '^SLACK_BOT_TOKEN=' /opt/ops-manager/.env | cut -d= -f2- | tr -d '\r\n' | sha256sum
grep '^SLACK_APP_TOKEN=' /opt/ops-manager/.env | cut -d= -f2- | tr -d '\r\n' | sha256sum
```

## Commits shipped 2026-05-20


| Commit    | Summary                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `538ef1e` | fix: env-var substitution for all secrets in `docker-compose.yml` (bare `${VAR}`, fail-loud — no committed dev passwords) |
| `72a9c91` | fix(db): sync `ops_app` role password from `DATABASE_URL` after migrations, with a Vitest integration test                |
| `1043a9d` | chore(deploy): add `scripts/env.template` + `scripts/scaffold-env.sh` for generating the droplet `.env`                   |
| `65989c6` | docs: make the DO droplet (`/opt/ops-manager`) the canonical deployment; laptop compose = local dev only                  |


## What changed and why

Phase 1 moved from a laptop-only docker-compose stack to a real, single-source production deployment on the DigitalOcean droplet. The compose file's hardcoded dev passwords were replaced with **fail-loud `${VAR}` substitution**, so a missing secret stops the stack rather than silently booting with public dev credentials. Because `migrations/002_audit_log.sql` hardcodes the `ops_app` login password (`dev_password`) for clean first-run bootstrap, `runMigrations()` now **re-syncs that role's password from `DATABASE_URL` on every boot** — letting a strong, env-driven `POSTGRES_APP_PASSWORD` work without ever editing the committed migration (covered by `tests/lib/db/migrate.test.ts`). Secrets are produced **on the droplet** by `scaffold-env.sh` rendering `env.template`, so they're never committed and never transit the network. During cutover there was a window where the old laptop stack and the droplet both held the **same Slack token**, causing duplicate hourly heartbeats and non-deterministic `/ops` command routing; that was resolved by decommissioning the laptop, leaving the droplet as the only socket — confirmed by a single 11:00 AM CT heartbeat in `#ops-manager-alerts`.