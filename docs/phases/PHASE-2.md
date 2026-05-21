# Phase 2 — GHL Visibility

Phase 2 starts with a roster sync because every later GHL health check needs a reliable
account list and token reference.

## Roster source

The current roster can live in Google Sheets. Expected columns are flexible; these
aliases are recognized:

| Field | Accepted headers |
| --- | --- |
| Account name | `Account Name`, `Client`, `Client Name`, `Name` |
| GHL location ID | `GHL Location ID`, `Location ID`, `ghl_location_id` |
| PIT token | `Personal Integration Token`, `PIT Token`, `GHL PIT Token` |
| PIT token reference | `PIT Token Ref`, `GHL PIT Token Ref` |
| Status | `Status`, `Account Status` |
| Assistable subaccount ID | `Assistable Subaccount ID`, `Assistable ID` |
| n8n workflow IDs | `n8n Workflow IDs`, `n8n Workflows` |

## Token safety

Do not paste a token-bearing Sheet URL into Slack, chat, GitHub, or the repo.

If a Google Sheet contains PIT tokens, keep it private and use a Google service
account:

1. Create a Google Cloud service account with Sheets read-only access.
2. Share the private roster Sheet with the service account email.
3. Put these values in the server `.env` only:
   - `GOOGLE_SHEET_ROSTER_SPREADSHEET_ID`
   - `GOOGLE_SHEET_ROSTER_RANGE` (default: `Roster!A:Z`)
   - `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SHEETS_PRIVATE_KEY`
   - `SECRETS_MASTER_KEY` (32-byte base64/base64url/hex key)

Published CSV URLs are supported through `GOOGLE_SHEET_ROSTER_CSV_URL`, but only for
tokenless rosters. A published or link-shareable token Sheet exposes the PIT tokens to
anyone with that URL.

During sync, PIT token values are written only to the encrypted `secrets` table. The
`accounts` table stores a `secret:...` reference in `ghl_pit_token_ref`; Slack output,
skill output, metadata, and audit logs report only whether a token is stored.

## Implemented in this slice

- `ghl.list-accounts` skill
  - lists stored account roster
  - optionally syncs from Google Sheets
- encrypted `secrets` table for PIT token storage
- `/ops accounts` Slack summary with token-present/token-missing status only
- `/ops sync-roster` Slack command to load the private Sheet into `accounts`/`secrets`

## GHL PIT token health

`ghl.check-pit-token` validates stored PIT tokens against LeadConnector v2:

- `GET https://services.leadconnectorhq.com/locations/{locationId}`
- `Authorization: Bearer <encrypted PIT after decrypt>`
- `Version: 2021-07-28`

Statuses:

| Status | Meaning |
| --- | --- |
| `valid` | LeadConnector returned 2xx |
| `invalid` | LeadConnector returned 401 |
| `forbidden` | LeadConnector returned 403; token may lack scope/access |
| `not_found` | LeadConnector returned 404 for the stored location ID |
| `unreachable` | Network timeout, 5xx, or other transient failure |
| `missing-token` | Account has no PIT token reference |
| `missing-location` | Account has no GHL location ID |
| `secret-error` | Encrypted PIT token could not be read/decrypted |

Operators can run `/ops check-tokens` on demand. A scheduled daily job runs on
`GHL_TOKEN_HEALTH_CRON` (default `15 13 * * *`) and posts a summary to
`SLACK_ALERTS_CHANNEL`. Results are stored on each account as `ghl_token_status`,
`ghl_token_checked_at`, and `metadata.ghlTokenHealth`.

## Remaining Phase 2 work

1. `ghl.list-pipelines` and `ghl.list-opportunities` weekly snapshot.
2. `ghl.list-workflows` and `ghl.list-custom-fields` monthly inventory.
3. `/ops ghl-snapshot <account-name>` per-account report.

