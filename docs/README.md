# `docs/`

Cuantico-internal reference documentation for the ops-manager service. Lives in the repo so it travels with the code that consumes it.

## Index

| File | Purpose | Last reviewed |
|---|---|---|
| [`assistable-v3-reference.md`](./assistable-v3-reference.md) | Full Assistable v3 reference — op surface, variable templating, contact-tag state machine, GHL workflow stack, DNC posture, Phase 6 friction map | June 2026 (v2) |

## Subdirectories

- `phases/` — phase scoping docs (`PHASE-2.md` through `PHASE-5.md` shipped, future `PHASE-6.md` for the Assistable v3 Bot Factory integration)
- `handoffs/` — session handoff prompts for transferring context between Claude sessions; dated `YYYY-MM-DD-<topic>.md`

## What lives here vs elsewhere

**Lives here:**
- Cuantico-specific references that ops-manager code or operators consult repeatedly
- Research findings that would otherwise be lost when sessions end
- The *Cuantico way* of doing something (per-vertical policy, deployment patterns, integration conventions) that isn't in any public doc

**Does NOT live here:**
- Public vendor docs (Assistable / GHL / n8n) — link them, don't mirror
- Session-specific working notes — those go in `handoffs/`
- Per-client information — those belong in client folders or Drive, not the repo
- API key material or secrets of any kind

## Conventions

- **Naming:** `<topic>-reference.md` for primary references, `<topic>-guide.md` for tactical how-tos, `<topic>-decision.md` for decision records
- **Maintenance:** when a doc here is updated, bump its "Last reviewed" entry in the index. When a doc becomes stale or wrong, fix it or delete it — drift is worse than a missing doc
- **Length:** comprehensive where it earns its place, terse where it doesn't. Every section should answer a question someone will actually ask
- **Open questions:** explicitly tracked in each doc. Closing one = updating that doc, not creating a new one

## Suggested future docs

Not yet written. Add when the underlying knowledge is mature enough to be worth capturing:

- `ghl-v2-reference.md` — Cuantico-specific GHL v2 API reference (PIT auth, scope gotchas, snapshot and workflow patterns)
- `n8n-patterns.md` — standard n8n workflow patterns (credential-from-Postgres, Slack node convention, error-handler shape)
- `bot-factory-architecture.md` — once Phase 6 lands, the canonical reference for how GHL + n8n + Assistable compose into the Bot Factory
- `client-onboarding-runbook.md` — end-to-end "new client" sequence (GHL snapshot, custom values seed, Assistable sub-account, baseline workflows, first bot deploy)
- `voice-script-standard.md` — the Taylor pattern (Identity → Personality → Style Guardrails → Task Flow → Silent Tool Usage) lifted from memory into the repo
