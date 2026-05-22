# Phase 3 — Cross-platform health

Phase 3 adds read-only health checks beyond GHL. The first slice is Assistable OAuth
connection status across the fleet.

## Assistable OAuth health

`assistable.check-oauth-status` validates whether each account's Assistable location can
reach GoHighLevel through Assistable.

Assistable does not publish a dedicated OAuth status endpoint. During the API3
migration, the documented `GET /v2/get-contacts/{location_id}` route may return
404 even when the location is healthy. The check uses a read-only conversation
probe instead:

- `GET https://api.assistable.ai/v2/get-conversation?location_id=...&contact_id=ops-manager-health-probe`
- `Authorization: Bearer <ASSISTABLE_API_KEY>`

Statuses:

| Status | Meaning |
| --- | --- |
| `connected` | Assistable returned 2xx and the location has a usable GHL access token. A probe contact with no conversation still counts as connected. |
| `disconnected` | Assistable reported no GHL access token / CRM connection for the location |
| `not_found` | Assistable returned 404 for the location probe |
| `auth-error` | Assistable returned 401, or `ASSISTABLE_API_KEY` is missing |
| `unreachable` | Network timeout, 5xx, or other transient failure |
| `missing-subaccount-id` | Account has no Assistable subaccount ID or GHL location ID to probe |

Location ID resolution:

1. `accounts.assistable_subaccount_id` from the roster Sheet, if present
2. fallback to `accounts.ghl_location_id`

Operators can run `/ops check-assistable` on demand, or target one account by name:
`/ops check-assistable Harrison Ford Auto`. A scheduled daily job runs on
`ASSISTABLE_OAUTH_HEALTH_CRON` (default `30 13 * * *`, 15 minutes after the GHL token
health job) and posts a summary to `SLACK_ALERTS_CHANNEL`. Results are stored on each
account as `assistable_oauth_status`, `assistable_oauth_checked_at`, and
`metadata.assistableOAuthHealth`.

Important limitation: `connected` means Assistable accepted the location probe. If CRM
actions still fail in Assistable, verify the sub-account connection in the Assistable
dashboard and re-authorize OAuth if needed.

## Required env vars

Add these to the droplet `.env` only:

```
ASSISTABLE_API_KEY=
# Optional overrides:
# ASSISTABLE_API_BASE_URL=https://api.assistable.ai
# ASSISTABLE_API_TIMEOUT_MS=15000
# ASSISTABLE_OAUTH_HEALTH_CRON=30 13 * * *
```

## Remaining Phase 3 work

1. `n8n.check-workflow-health` across client workflows on `n8n.voyze.ai`
2. Unified daily health post combining GHL + Assistable + n8n in one Slack thread
