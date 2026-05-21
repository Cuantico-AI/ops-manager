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

## Remaining Phase 2 work

1. `ghl.check-pit-token` daily health job and Slack summary.
2. `ghl.list-pipelines` and `ghl.list-opportunities` weekly snapshot.
3. `ghl.list-workflows` and `ghl.list-custom-fields` monthly inventory.
4. `/ops ghl-snapshot <account-name>` per-account report.

