# Phase 4 — Mutating operations with approval gates

Phase 4 adds the first write-capable skills, all gated by Slack approval in production.

## Security rules

1. Mutating skills set `mutates: true` and call `ctx.approval.gate(...)` before any external write.
2. When `BYPASS_APPROVAL=true` (local dev only), the gate auto-approves.
3. In production, `BYPASS_APPROVAL` must be unset. Pending actions post to
   `SLACK_APPROVALS_CHANNEL` with Approve/Reject buttons.
4. Approvals expire after `APPROVAL_EXPIRY_HOURS` (default 4).
5. Slack approval messages include the full proposed action payload.

## Approval flow

1. Operator runs a mutating slash command (e.g. `/ops set-custom-value ...`).
2. Skill validates input and calls `ctx.approval.gate(...)`.
3. Gate inserts an `approvals` row, sets the job to `awaiting_approval`, and posts to Slack.
4. Operator approves via button or `/ops approve <approval-id>`.
5. Ops Manager resumes the job; the gate sees the approved record and the skill completes the write.

Reject via button or `/ops reject <approval-id>`.

## Slice 1 (this PR)

- Approval infrastructure (`ApprovalGate`, Slack flow, actions, resume)
- `/ops approve`, `/ops reject`, `/ops jobs`
- `ghl.set-custom-value` — update a GHL location custom value via PIT token
- `/ops set-custom-value <account> <customValueId> <value>`

## Slice 2 (this PR)

- `n8n.trigger-workflow` — execute a tracked client workflow on demand
- `/ops trigger-n8n <account> [workflowId]`

## Slice 3 (next)

- `assistable.refresh-oauth` — refresh Assistable GHL OAuth for disconnected accounts
- `/ops refresh-assistable <account>`

## Required env vars

Add these to the droplet `.env` only:

```
# Production: omit BYPASS_APPROVAL entirely
# Dev only:
# BYPASS_APPROVAL=true

SLACK_APPROVALS_CHANNEL=#ops-manager-approvals
# APPROVAL_EXPIRY_HOURS=4
```
