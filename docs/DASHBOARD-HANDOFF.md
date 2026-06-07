# Dashboard + Read API — Handoff

**Status:** Complete and verified. Both workspaces typecheck clean; the dashboard runs end-to-end on mock data.

## What shipped

- **Monorepo (npm workspaces).** Root (`src/`) backend + two workspaces:
  - `packages/contracts` (`@cuantico/contracts`) — shared Zod schemas + TS types + enums for the read model. Imported by both backend and dashboard, so a shape change is a compile error on both sides.
  - `apps/dashboard` (`@cuantico/dashboard`) — React + TS + Vite rebuild of the Claude Design prototype. Router, React Query data layer (`src/lib/api.ts`) polling `/api`, all views (Fleet, Requests, Approval Gate, Account Detail, QA, Audit).
- **Read API** in `src/api/`, registered in `src/server.ts` via `registerReadApi`. Endpoints: `/api/fleet`, `/api/accounts/:id`, `/api/requests`, `/api/approvals` (+`/resolve`), `/api/qa/flags`, `/api/qa/health` (+`/api/qa/flags/:id/resolve`), `/api/audit`, `/api/meta`.
- **Swappable data source** via `DASHBOARD_API_SOURCE`:
  - `mock` (default) — `src/api/mock-data.ts`, zero infra.
  - `postgres` — `src/api/postgres-data-source.ts`, wired to accounts/approvals/audit_log/qa_reviews + new tables.
- **New migrations:** `026_dashboard_requests.sql` (work queue), `027_qa_flag_resolutions.sql` (QA confirm/dismiss state).
- **API-only boot mode:** `DASHBOARD_API_ONLY=true` skips migrations/Slack/workers so the mock dashboard runs with no DB/Redis/Slack.
- **June review** copied to repo (`ARCHITECTURE-REVIEW-2026-06.md`) with a companion pointer in `ARCHITECTURE.md`.

## Run it

```powershell
# terminal 1 — read API only (mock data, no infra)
$env:DASHBOARD_API_ONLY="true"; npm run dev      # or: npm run dev:api  (after reinstall)
# terminal 2 — dashboard
npm run dev:dashboard                             # http://localhost:5173
```

## Next steps / open items

1. **Run `npm install` again.** `package.json` changed after the last install (added `cross-env` + `dev:api`), so `package-lock.json` is stale. Docker's `npm ci` needs it in sync.
2. **Wire real data (postgres mode):** bring up infra (`docker compose up postgres redis -d`, point `DATABASE_URL`/`REDIS_URL` at localhost), apply migrations (`npm run migrate`), then run the **full** backend (`npm run dev`, not `dev:api`) with `DASHBOARD_API_SOURCE=postgres`. A fresh DB is mostly empty → dashboard looks sparse until data exists (expected).
3. **Backend-gap fields** still derived/placeholder in postgres mode (flagged in `postgres-data-source.ts`): PIT days-to-expiry, Assistable minute-cap usage, per-day activity sparkline, QA daily trend. Promote to real columns/rollups when ready.
4. **QA flag transcripts** aren't persisted (privacy) — postgres mode shows only the flagged quote. Decide if a transcript reference should be stored.
5. **Dashboard deploy** is decoupled (static Vite build, `npm run build --workspace @cuantico/dashboard`). Backend Docker image currently installs dashboard runtime deps for lockfile consistency (minor bloat) — optional optimization: `npm ci --omit=dev --workspace=@cuantico/contracts --include-workspace-root`.
6. **Security:** 1 pre-existing critical npm vuln. Review deliberately; do **not** `npm audit fix --force`.

## Key files

- Contract: `packages/contracts/src/{enums,entities,responses,index}.ts`
- API: `src/api/{index,data-source,data-source-factory,mock-data,mock-data-source,postgres-data-source}.ts`
- Server wiring: `src/server.ts`
- Dashboard: `apps/dashboard/src/{App.tsx,main.tsx,lib/api.ts,views/*,components/*}`
- Plan (do not edit): `.cursor/plans/ops_manager_dashboard_api_34acceba.plan.md`
