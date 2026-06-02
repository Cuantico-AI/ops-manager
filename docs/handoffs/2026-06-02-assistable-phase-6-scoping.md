# Handoff — Assistable Phase 6 Scoping

**Date:** 2026-06-02
**Previous session:** Built the Assistable v3 internal reference doc (v2) from the OpenAPI spec + 8 priority docs pages. Now committed to `ops-manager/docs/assistable-v3-reference.md`.
**Next session's job:** Run the duplicateAssistant inheritance test, then scope Phase 6 in `ops-manager/docs/phases/PHASE-6.md`.

> **Numbering note:** the Assistable v3 Bot Factory deployment integration is **Phase 6**, not Phase 3. The shipped `docs/phases/PHASE-3.md` is a different effort (cross-platform read-only health — Assistable OAuth + n8n). Do not overwrite it. This handoff and the v3 reference doc were originally drafted as "Phase 3" and have been renumbered to Phase 6.

---

## Context

The Assistable v3 reference doc is comprehensive — full op surface (15 resource groups, ~85 ops), enums, auth model, variable-driven templating, contact-tag state machine, baseline GHL workflow stack, per-vertical DNC posture, and a documented Phase 6 friction map. **Read it first before responding to this handoff.**

Key findings to internalize:

- **Variable-driven templating is the multi-tenant unlock.** One Taylor template serves all 40 sub-accounts because `{{location.*}}` and `{{custom_values.*}}` resolve from each sub-account's GHL data at runtime. Same prompt string everywhere, different runtime resolution per account.
- **Contact-tag state machine governs all AI behavior.** No active tag = silent (default opt-out). Active tag identity = which assistant routes. `ai_off` = hard kill override. `ai_replying` = in-flight signal for stuck-state detection.
- **Snapshots are forward-only.** They solve onboarding for *new* sub-accounts but cannot push updates to the existing 40. This is what makes the Bot Factory deployment work uniquely valuable — it's the only path to fleet-wide template updates on the existing fleet.
- **6 UI-only friction points** block 100% API-driven deployment. The most consequential are webhook URL config and active tag bindings.

## Current state of ops-manager

Scoping docs that exist in the repo today:

- **Phase 1 — Chassis:** complete on droplet `147.182.131.74` (heartbeat cron, `/ops ping`, immutable `audit_log`, migrations applied).
- **Phase 2 — GHL Visibility:** scoped in `docs/phases/PHASE-2.md` (roster sync + GHL read-only health).
- **Phase 3 — Cross-platform health:** scoped in `docs/phases/PHASE-3.md` (Assistable OAuth connection health + n8n workflow health + unified daily fleet health). Marked complete in that doc.
- **Phase 4 — Mutating operations with approval gates:** scoped in `docs/phases/PHASE-4.md`.
- **Phase 5 — Agent roles:** scoped in `docs/phases/PHASE-5.md` (QA Review first).
- **Phase 6 — Assistable v3 Bot Factory deployment integration:** this handoff. **NOT yet committed to a scoping doc** because the blocking test below must resolve first.

> The current `docs/phases/PHASE-3.md` Assistable work uses the legacy v2 OAuth-probe endpoints (`GET /v2/get-conversation`). Phase 6 is a separate, additive integration against the new v3 first-party API (`ask_live_…` keys, `/v3/*`). Decide explicitly whether v3 supplements or eventually replaces the v2 health probe.

## The blocking decision

Before Phase 6 can be scoped concretely, one sandbox test must run:

**Does `POST /v3/assistants/{id}/duplicate` carry these bindings to the duplicate?**

1. Pre-call webhook URL
2. Post-call webhook URL
3. Active tag binding (tag → assistant + phone number)
4. Tool assignments
5. Knowledge base assignment
6. Phone number assignment

### Two possible outcomes

**If duplication carries all bindings:**
Bot Factory deployment is 100% API-driven via template-and-duplicate. Phase 6 scope is small and clean — build a Taylor template once, duplicate it to each of 40 sub-accounts, override variables per account via `updateAssistant`. Done.

**If duplication does NOT carry one or more bindings:**
Each missing binding becomes a required manual or browser-automated step. Phase 6 must add a "wire bindings" workflow with Slack approval gates per binding, or pull in a browser MCP fallback to UI-wire what the API can't.

Either way, the *templating* story is unchanged — variable-driven prompts work the same regardless. Only the deployment mechanics shift.

## Next concrete action

1. **Pick a sandbox sub-account.** Suggest a non-production internal Cuantico test account — never run this on a live client account.
2. **Stand up a "Taylor template" assistant** in that sub-account with all six bindings configured manually via the UI.
3. **Call duplicate:**
   ```bash
   assistableai assistants duplicate <assistant_id> -s <sandbox_sid>
   ```
   or via SDK / REST.
4. **Inspect the duplicate** via `getAssistant`, plus the Assistable UI under Call Settings, Active Tags, Tools, Knowledge Bases, and Phone Numbers. Record which bindings carried over and which did not.
5. **Update `ops-manager/docs/assistable-v3-reference.md`** — close open question #3 with the result and rewrite the Phase 6 friction-points section accordingly.
6. **Scope Phase 6** in `ops-manager/docs/phases/PHASE-6.md` based on the resolved deployment model.

## Open questions (other than the duplication test)

In priority order:

1. **Key scoping.** Can one `ask_live_…` key cover all 40 sub-accounts simultaneously, or do we need 40 keys? Affects the `secrets` table schema. Verify in Assistable admin UI.
2. **`assistant_task_completion` exposure.** Is the structured task-success signal in `getCall` response, or webhook-only? Affects whether ops-manager polls for it or captures it through the GHL workflow hop.
3. **DNC pipeline parity.** Does v3 `createCall` route through the same three-layer DNC screen as the GHL Make AI Call action? Affects whether we can trust the API path for compliance.
4. **`memory` variable.** What's the persistence model — per-contact, per-conversation, cross-conversation? Could replace some GHL custom field state.
5. **Multi-tag behavior.** If a contact has two active tags, which assistant handles them? First-match, last-applied, undefined? Enforce single-tag invariant until verified.
6. **Snapshot Assistant ID API.** Is the agency snapshot's assistant template list manageable via API, or strictly UI?
7. **Flows surface.** Beyond `createFlow`, is there list/update/delete API access, or strictly UI?

## Constraints and conventions

- **Droplet is canonical.** ops-manager runs on `147.182.131.74` at `/opt/ops-manager`. Laptop has been retired. All code lives in the repo; deploys are `git pull origin main && docker compose up -d --build` on the droplet.
- **Env-only changes** restart without rebuild.
- **`BYPASS_APPROVAL=true`** currently — must flip before Phase 4 mutations.
- **Credentials never in n8n** credentials or expressions (Slack log exposure risk). Query from Postgres `secrets` table at workflow start.
- **Heredocs piped through PowerShell → SSH → bash corrupt multi-line content.** Write as repo files, then `git pull` on the droplet.
- **Nano is unusable interactively over SSH from PowerShell.** Use `sed -i` for .env edits.
- **Jonathan eyeballs every diff and SSH command individually.** Friction is the feature. Don't bundle multiple commands; present them one at a time with the diff visible.
- **Cuantico Slack ops bot:** `opsmanager` (U0B4SMA06UC / B0B4KMA69JR / T0AHUMHAZD1).
- **n8n instance:** `n8n.voyze.ai` (v2.19.5, separate droplet `162.243.244.230`).
- **Slack notifications in n8n:** native Slack node only, credential name `Slack - Cuantico`. Never HTTP Request.

## Files to read in order

1. `ops-manager/docs/assistable-v3-reference.md` — the canonical reference
2. `ops-manager/ARCHITECTURE.md` — overall architecture
3. `ops-manager/docs/phases/PHASE-3.md` — the shipped Assistable v2 OAuth health work (don't confuse with Phase 6)
4. This handoff

## External references

- `https://docs.assistable.ai/llms.txt` — Assistable's doc index. **Note:** the site bot-blocks LLM fetchers. To pull new docs pages, the operator opens them in a browser and pastes content into the chat manually.
- `https://docs.assistable.ai/v3/openapi.json` — canonical v3 OpenAPI spec
- `https://docs.assistable.ai` — root docs (also bot-blocked)

---

## Starting prompt for the next session

> I'm picking up from where we left off on ops-manager Phase 6 scoping (Assistable v3 Bot Factory integration — not the shipped Phase 3 health work). Read `ops-manager/docs/assistable-v3-reference.md` and `ops-manager/docs/handoffs/2026-06-02-assistable-phase-6-scoping.md` before responding. The blocking action is the `duplicateAssistant` inheritance test — let's design the sandbox test plan first, then move to Phase 6 scoping based on the result.
