import { Buffer } from 'node:buffer';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { describeIntegration as describe } from '../../helpers.js';
import { auditLogger } from '../../../src/lib/audit/log.js';
import { approvalGate } from '../../../src/lib/approval/gate.js';
import { query } from '../../../src/lib/db/client.js';
import { llmClient } from '../../../src/lib/llm/client.js';
import { ghlListAccountsSkill } from '../../../src/skills/ghl/list-accounts.js';

describe('ghl.list-accounts skill', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SECRETS_MASTER_KEY;
    delete process.env.GOOGLE_SHEET_ROSTER_CSV_URL;
    delete process.env.GOOGLE_SHEET_ROSTER_SPREADSHEET_ID;
    delete process.env.GOOGLE_SHEET_ROSTER_RANGE;
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  });

  it('syncs a private Google Sheet roster without exposing PIT token values', async () => {
    process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GOOGLE_SHEET_ROSTER_SPREADSHEET_ID = 'test-sheet';
    process.env.GOOGLE_SHEET_ROSTER_RANGE = 'Roster!A:Z';
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = 'ops-roster@example.iam.gserviceaccount.com';
    process.env.GOOGLE_SHEETS_PRIVATE_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const jobId = randomUUID();
    const accountName = `Roster Sync ${randomUUID()}`;
    const locationId = `loc_${randomUUID()}`;
    const pitToken = `pit_${randomUUID()}`;

    await query(
      `INSERT INTO jobs (id, agent_id, trigger_type, status) VALUES ($1, 'system', 'manual', 'running')`,
      [jobId],
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: URL | string) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: vi.fn().mockResolvedValue({ access_token: 'test-access-token' }),
          });
        }

        expect(url).toContain('https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/');
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: vi.fn().mockResolvedValue({
            values: [
              ['Account Name', 'GHL Location ID', 'Personal Integration Token'],
              [accountName, locationId, pitToken],
            ],
          }),
        });
      }),
    );

    const result = await ghlListAccountsSkill.execute(
      {
        syncFromGoogleSheet: true,
      },
      {
        jobId,
        agentId: 'system',
        audit: auditLogger,
        approval: approvalGate,
        llm: llmClient,
      },
    );

    expect(result.sync).toMatchObject({ totalRows: 1, inserted: 1, tokensStored: 1 });

    const synced = result.accounts.find((account) => account.ghlLocationId === locationId);
    expect(synced).toMatchObject({
      name: accountName,
      pitTokenStatus: 'stored',
    });

    const accountRows = await query<{
      ghl_pit_token_ref: string;
      metadata: Record<string, unknown>;
    }>('SELECT ghl_pit_token_ref, metadata FROM accounts WHERE ghl_location_id = $1', [locationId]);
    expect(accountRows.rows[0]?.ghl_pit_token_ref).toMatch(/^secret:account:/);
    expect(JSON.stringify(accountRows.rows[0]?.metadata)).not.toContain(pitToken);

    const secretRows = await query<{ encrypted_value: string }>(
      'SELECT encrypted_value FROM secrets WHERE id = $1',
      [accountRows.rows[0]?.ghl_pit_token_ref.replace(/^secret:/, '')],
    );
    expect(secretRows.rows[0]?.encrypted_value).toBeTruthy();
    expect(secretRows.rows[0]?.encrypted_value).not.toContain(pitToken);

    const auditRows = await query<{ input: unknown; output: unknown }>(
      'SELECT input, output FROM audit_log WHERE job_id = $1 ORDER BY id',
      [jobId],
    );
    expect(JSON.stringify(auditRows.rows)).not.toContain(pitToken);
  });
});
