import { createSign } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type pg from 'pg';
import { getPool, query } from '../db/client.js';
import { ExternalServiceError, ValidationError } from '../errors.js';
import { fingerprintPitToken, normalizePitToken } from '../ghl/token-utils.js';
import { PostgresSecretStore, type SecretStore } from '../secrets/store.js';

const MAX_ROSTER_CSV_BYTES = 5 * 1024 * 1024;
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const columnAliases = {
  name: ['name', 'account name', 'client', 'client name', 'subaccount name'],
  status: ['status', 'account status'],
  ghlLocationId: ['ghl location id', 'location id', 'ghl_location_id', 'locationid'],
  ghlPitToken: [
    'ghl pit token',
    'pit',
    'pit token',
    'personal integration token',
    'personal integration token (pit)',
    'ghl_pit_token',
  ],
  ghlPitTokenRef: ['ghl pit token ref', 'pit token ref', 'ghl_pit_token_ref'],
  assistableSubaccountId: ['assistable subaccount id', 'assistable_subaccount_id', 'assistable id'],
  n8nWorkflowIds: ['n8n workflow ids', 'n8n_workflow_ids', 'n8n workflows'],
} as const;

type CanonicalColumn = keyof typeof columnAliases;

export interface RosterRow {
  rowNumber: number;
  name: string;
  status?: string;
  ghlLocationId?: string;
  ghlPitToken?: string;
  ghlPitTokenRef?: string;
  assistableSubaccountId?: string;
  n8nWorkflowIds: string[];
}

export interface AccountSummary {
  id: string;
  name: string;
  status: string;
  ghlLocationId: string | null;
  pitTokenStatus: 'stored' | 'missing';
  assistableSubaccountId: string | null;
  n8nWorkflowIds: string[];
  updatedAt: string;
}

export interface RosterSyncSummary {
  totalRows: number;
  inserted: number;
  updated: number;
  tokensStored: number;
  tokenRefsSet: number;
}

interface GoogleSheetsApiConfig {
  spreadsheetId: string;
  range: string;
  serviceAccountEmail: string;
  privateKey: string;
}

interface LoadedRosterRows {
  rows: RosterRow[];
  source: 'csv-url' | 'google-sheets-api';
}

export function toGoogleSheetCsvExportUrl(sheetUrl: string): string {
  const parsed = new URL(sheetUrl);
  if (parsed.hostname !== 'docs.google.com') {
    return sheetUrl;
  }

  const spreadsheetId = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (!spreadsheetId) {
    return sheetUrl;
  }

  if (parsed.pathname.includes('/export') || parsed.pathname.includes('/pub')) {
    parsed.searchParams.set('output', 'csv');
    return parsed.toString();
  }

  const gid = parsed.hash.match(/gid=(\d+)/)?.[1] ?? parsed.searchParams.get('gid') ?? '0';
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`);
  exportUrl.searchParams.set('format', 'csv');
  exportUrl.searchParams.set('gid', gid);
  return exportUrl.toString();
}

export async function fetchRosterCsv(
  url = process.env.GOOGLE_SHEET_ROSTER_CSV_URL,
): Promise<string> {
  if (!url) {
    throw new ValidationError('GOOGLE_SHEET_ROSTER_CSV_URL is required to sync the GHL roster');
  }

  const res = await fetch(toGoogleSheetCsvExportUrl(url));
  if (!res.ok) {
    const body = await safeReadResponseBody(res);
    throw new ExternalServiceError(
      `Google Sheet roster fetch failed: ${formatHttpError(res, body)}`,
      'GOOGLE_SHEET_ROSTER_FETCH_FAILED',
    );
  }

  const csv = await res.text();
  if (Buffer.byteLength(csv, 'utf8') > MAX_ROSTER_CSV_BYTES) {
    throw new ValidationError('Google Sheet roster CSV is too large');
  }

  return csv;
}

export function parseRosterCsv(csv: string): RosterRow[] {
  const records = parse(csv, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return parseRosterRecords(records);
}

async function listAccounts(): Promise<AccountSummary[]> {
  const { rows } = await query<{
    id: string;
    name: string;
    status: string;
    ghl_location_id: string | null;
    ghl_pit_token_ref: string | null;
    assistable_subaccount_id: string | null;
    n8n_workflow_ids: string[] | null;
    updated_at: Date;
  }>(
    `SELECT id, name, status, ghl_location_id, ghl_pit_token_ref,
            assistable_subaccount_id, n8n_workflow_ids, updated_at
     FROM accounts
     ORDER BY name ASC`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    ghlLocationId: row.ghl_location_id,
    pitTokenStatus: row.ghl_pit_token_ref ? 'stored' : 'missing',
    assistableSubaccountId: row.assistable_subaccount_id,
    n8nWorkflowIds: row.n8n_workflow_ids ?? [],
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function listStoredAccounts(): Promise<AccountSummary[]> {
  return listAccounts();
}

export async function syncRosterRows(
  rows: RosterRow[],
  opts: { source: string; secretStore?: SecretStore },
): Promise<RosterSyncSummary> {
  const client = await getPool().connect();
  const summary: RosterSyncSummary = {
    totalRows: rows.length,
    inserted: 0,
    updated: 0,
    tokensStored: 0,
    tokenRefsSet: 0,
  };

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const existingId = await findExistingAccountId(client, row);
      const accountId = await upsertAccount(client, row, existingId, null, opts.source);
      const tokenRef = await resolveTokenRef(row, accountId, client, opts.secretStore);

      if (tokenRef) {
        await client.query(
          `UPDATE accounts
           SET ghl_pit_token_ref = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [tokenRef, accountId],
        );

        if (row.ghlPitToken) {
          summary.tokensStored += 1;
        } else {
          summary.tokenRefsSet += 1;
        }
      }

      if (existingId) {
        summary.updated += 1;
      } else {
        summary.inserted += 1;
      }
    }

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function syncGoogleSheetRoster(
  url = process.env.GOOGLE_SHEET_ROSTER_CSV_URL,
): Promise<{ summary: RosterSyncSummary; accounts: AccountSummary[] }> {
  const roster = await loadRosterRows(url);
  if (roster.source === 'csv-url' && roster.rows.some((row) => row.ghlPitToken)) {
    throw new ValidationError(
      'Roster CSV URLs must not contain PIT token values; use Google Sheets service account env vars for token-bearing rosters',
    );
  }

  const summary = await syncRosterRows(roster.rows, {
    source: 'google-sheet',
  });
  const accounts = await listAccounts();
  return { summary, accounts };
}

async function loadRosterRows(url: string | undefined): Promise<LoadedRosterRows> {
  if (url) {
    const csv = await fetchRosterCsv(url);
    return { rows: parseRosterCsv(csv), source: 'csv-url' };
  }

  const apiConfig = getGoogleSheetsApiConfig();
  if (apiConfig) {
    return {
      rows: await fetchRosterRowsFromGoogleSheetsApi(apiConfig),
      source: 'google-sheets-api',
    };
  }

  throw new ValidationError(
    'Configure GOOGLE_SHEET_ROSTER_CSV_URL or Google Sheets service account roster env vars',
  );
}

function getGoogleSheetsApiConfig(): GoogleSheetsApiConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEET_ROSTER_SPREADSHEET_ID;
  const serviceAccountEmail = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const range = process.env.GOOGLE_SHEET_ROSTER_RANGE ?? 'Roster!A:Z';
  const anyConfigured = Boolean(spreadsheetId || serviceAccountEmail || privateKey);

  if (!anyConfigured) {
    return null;
  }

  if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
    throw new ValidationError(
      'GOOGLE_SHEET_ROSTER_SPREADSHEET_ID, GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SHEETS_PRIVATE_KEY are required together',
    );
  }

  return {
    spreadsheetId,
    range,
    serviceAccountEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

async function fetchRosterRowsFromGoogleSheetsApi(
  config: GoogleSheetsApiConfig,
): Promise<RosterRow[]> {
  const accessToken = await getGoogleSheetsAccessToken(config);
  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(config.range)}`,
  );
  valuesUrl.searchParams.set('majorDimension', 'ROWS');

  const res = await fetch(valuesUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await safeReadResponseBody(res);
    throw new ExternalServiceError(
      `Google Sheets API roster fetch failed: ${formatHttpError(res, body)}`,
      'GOOGLE_SHEETS_API_ROSTER_FETCH_FAILED',
    );
  }

  const payload = (await res.json()) as { values?: unknown[][] };
  return parseRosterTable(payload.values ?? []);
}

async function getGoogleSheetsAccessToken(config: GoogleSheetsApiConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = [
    base64UrlJson({ alg: 'RS256', typ: 'JWT' }),
    base64UrlJson({
      iss: config.serviceAccountEmail,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  ].join('.');
  const signature = createSign('RSA-SHA256').update(assertion).sign(config.privateKey);
  const jwt = `${assertion}.${base64Url(signature)}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await safeReadResponseBody(res);
    throw new ExternalServiceError(
      `Google Sheets service account auth failed: ${formatHttpError(res, body)}`,
      'GOOGLE_SHEETS_AUTH_FAILED',
    );
  }

  const payload = (await res.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new ExternalServiceError(
      'Google Sheets service account auth did not return an access token',
      'GOOGLE_SHEETS_AUTH_FAILED',
    );
  }

  return payload.access_token;
}

function parseRosterTable(values: unknown[][]): RosterRow[] {
  const [headerRow, ...dataRows] = values;
  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map((header) => String(header));
  const records = dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '')])),
  );

  return parseRosterRecords(records);
}

function parseRosterRecords(records: Record<string, string>[]): RosterRow[] {
  return records.map((record, index) => normalizeRosterRecord(record, index + 2));
}

function base64UrlJson(value: Record<string, unknown>): string {
  return base64Url(Buffer.from(JSON.stringify(value), 'utf8'));
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

async function safeReadResponseBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function formatHttpError(res: Response, body: string): string {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `${res.status} ${res.statusText}`;
  }

  return `${res.status} ${res.statusText}: ${trimmedBody.slice(0, 500)}`;
}

function normalizeRosterRecord(record: Record<string, string>, rowNumber: number): RosterRow {
  const values = buildCanonicalValues(record);
  const name = values.name?.trim();
  if (!name) {
    throw new ValidationError(`Roster row ${rowNumber} is missing an account name`);
  }

  return {
    rowNumber,
    name,
    status: optionalValue(values.status),
    ghlLocationId: optionalValue(values.ghlLocationId),
    ghlPitToken: optionalValue(values.ghlPitToken),
    ghlPitTokenRef: optionalValue(values.ghlPitTokenRef),
    assistableSubaccountId: optionalValue(values.assistableSubaccountId),
    n8nWorkflowIds: splitList(values.n8nWorkflowIds),
  };
}

function buildCanonicalValues(
  record: Record<string, string>,
): Partial<Record<CanonicalColumn, string>> {
  const values: Partial<Record<CanonicalColumn, string>> = {};
  const aliasMap = new Map<string, CanonicalColumn>();

  for (const [canonical, aliases] of Object.entries(columnAliases) as [
    CanonicalColumn,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      aliasMap.set(normalizeHeader(alias), canonical);
    }
  }

  for (const [header, value] of Object.entries(record)) {
    const canonical = aliasMap.get(normalizeHeader(header));
    if (canonical) {
      values[canonical] = value;
    }
  }

  return values;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitList(value: string | undefined): string[] {
  return (
    value
      ?.split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

async function findExistingAccountId(
  client: pg.PoolClient,
  row: RosterRow,
): Promise<string | null> {
  if (row.ghlLocationId) {
    const byLocation = await client.query<{ id: string }>(
      'SELECT id FROM accounts WHERE ghl_location_id = $1 LIMIT 1',
      [row.ghlLocationId],
    );
    if (byLocation.rows[0]) {
      return byLocation.rows[0].id;
    }
  }

  const byName = await client.query<{ id: string }>(
    'SELECT id FROM accounts WHERE lower(name) = lower($1) LIMIT 1',
    [row.name],
  );
  return byName.rows[0]?.id ?? null;
}

async function upsertAccount(
  client: pg.PoolClient,
  row: RosterRow,
  existingId: string | null,
  tokenRef: string | null,
  source: string,
): Promise<string> {
  const metadata = {
    source,
    rosterRowNumber: row.rowNumber,
    rosterSyncedAt: new Date().toISOString(),
  };

  if (existingId) {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE accounts
       SET name = $1,
           ghl_location_id = COALESCE($2, ghl_location_id),
           ghl_pit_token_ref = COALESCE($3, ghl_pit_token_ref),
           assistable_subaccount_id = COALESCE($4, assistable_subaccount_id),
           n8n_workflow_ids = $5,
           status = $6,
           metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
           updated_at = NOW()
       WHERE id = $8
       RETURNING id`,
      [
        row.name,
        row.ghlLocationId ?? null,
        tokenRef,
        row.assistableSubaccountId ?? null,
        row.n8nWorkflowIds,
        row.status ?? 'active',
        JSON.stringify(metadata),
        existingId,
      ],
    );
    return rows[0]?.id ?? existingId;
  }

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO accounts (
       name, ghl_location_id, ghl_pit_token_ref, assistable_subaccount_id,
       n8n_workflow_ids, status, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      row.name,
      row.ghlLocationId ?? null,
      tokenRef,
      row.assistableSubaccountId ?? null,
      row.n8nWorkflowIds,
      row.status ?? 'active',
      JSON.stringify(metadata),
    ],
  );

  const accountId = rows[0]?.id;
  if (!accountId) {
    throw new Error('Account insert did not return an id');
  }
  return accountId;
}

async function resolveTokenRef(
  row: RosterRow,
  accountId: string,
  client: pg.PoolClient,
  injectedStore: SecretStore | undefined,
): Promise<string | null> {
  if (row.ghlPitToken) {
    const pitToken = normalizePitToken(row.ghlPitToken);
    const secretStore = injectedStore ?? new PostgresSecretStore();
    return secretStore.upsertSecret(
      {
        id: `account:${accountId}:ghl-pit-token`,
        kind: 'ghl-pit-token',
        plaintext: pitToken,
        metadata: {
          accountId,
          source: 'google-sheet-roster',
          fingerprint: fingerprintPitToken(pitToken),
        },
      },
      client,
    );
  }

  return row.ghlPitTokenRef ?? null;
}
