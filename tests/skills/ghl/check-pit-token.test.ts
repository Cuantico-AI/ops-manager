import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { describeIntegration as describe } from '../../helpers.js';
import { auditLogger } from '../../../src/lib/audit/log.js';
import { approvalGate } from '../../../src/lib/approval/gate.js';
import { query } from '../../../src/lib/db/client.js';
import { llmClient } from '../../../src/lib/llm/client.js';
import { PostgresSecretStore } from '../../../src/lib/secrets/store.js';
import { ghlCheckPitTokenSkill } from '../../../src/skills/ghl/check-pit-token.js';

describe('ghl.check-pit-token skill', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SECRETS_MASTER_KEY;
  });

  it('decrypts stored PIT tokens, checks GHL, and stores token health status', async () => {
    process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
    const jobId = randomUUID();
    const accountId = randomUUID();
    const accountName = `Token Check ${randomUUID()}`;
    const locationId = `loc_${randomUUID()}`;
    const pitToken = `pit_${randomUUID()}`;
    const secretStore = new PostgresSecretStore();

    await query(
      `INSERT INTO jobs (id, agent_id, trigger_type, status) VALUES ($1, 'system', 'manual', 'running')`,
      [jobId],
    );
    await query(
      `INSERT INTO accounts (id, name, status, ghl_location_id)
       VALUES ($1, $2, 'active', $3)`,
      [accountId, accountName, locationId],
    );
    const tokenRef = await secretStore.upsertSecret({
      id: `account:${accountId}:ghl-pit-token`,
      kind: 'ghl-pit-token',
      plaintext: `Bearer ${pitToken}`,
    });
    await query('UPDATE accounts SET ghl_pit_token_ref = $1 WHERE id = $2', [tokenRef, accountId]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ghlCheckPitTokenSkill.execute(
      {
        accountId,
        concurrency: 1,
      },
      {
        jobId,
        agentId: 'system',
        audit: auditLogger,
        approval: approvalGate,
        llm: llmClient,
      },
    );

    expect(result.summary).toMatchObject({
      total: 1,
      valid: 1,
      needsAttention: 0,
    });
    expect(result.results[0]).toMatchObject({
      accountId,
      accountName,
      status: 'valid',
    });

    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain(`/locations/${locationId}`);
    expect(String(call?.[0])).not.toContain(pitToken);
    expect(call?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${pitToken}`,
    });

    const accountRows = await query<{
      ghl_token_status: string;
      metadata: Record<string, unknown>;
    }>('SELECT ghl_token_status, metadata FROM accounts WHERE id = $1', [accountId]);
    expect(accountRows.rows[0]?.ghl_token_status).toBe('valid');
    expect(JSON.stringify(accountRows.rows[0]?.metadata)).toContain('tokenFingerprint');
    expect(JSON.stringify(accountRows.rows[0]?.metadata)).not.toContain(pitToken);

    const auditRows = await query<{ input: unknown; output: unknown }>(
      'SELECT input, output FROM audit_log WHERE job_id = $1 ORDER BY id',
      [jobId],
    );
    expect(JSON.stringify(auditRows.rows)).not.toContain(pitToken);
  });
});
