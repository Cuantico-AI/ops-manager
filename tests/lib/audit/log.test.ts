import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { describeIntegration as describe } from '../../helpers.js';
import { AuditLogger } from '../../../src/lib/audit/log.js';
import { query } from '../../../src/lib/db/client.js';

describe('AuditLogger', () => {
  it('writes an audit log entry', async () => {
    const jobId = randomUUID();
    await query(
      `INSERT INTO jobs (id, agent_id, trigger_type, status) VALUES ($1, 'system', 'manual', 'running')`,
      [jobId],
    );
    const audit = new AuditLogger();

    await audit.log({
      jobId,
      actor: 'system',
      action: 'test.action',
      target: 'test-target',
      mutated: false,
      input: { foo: 'bar' },
      output: { ok: true },
    });

    const { rows } = await query<{ action: string; actor: string }>(
      'SELECT action, actor FROM audit_log WHERE job_id = $1 ORDER BY id DESC LIMIT 1',
      [jobId],
    );

    expect(rows[0]?.action).toBe('test.action');
    expect(rows[0]?.actor).toBe('system');
  });

  it('does not throw when insert fails', async () => {
    const audit = new AuditLogger();
    await expect(
      audit.log({
        jobId: '00000000-0000-4000-8000-000000000099',
        actor: 'system',
        action: 'test',
        target: 't',
        mutated: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an unsafe UUID cast in job_id', async () => {
    const audit = new AuditLogger();
    const invalidJobId = 'not-a-valid-uuid';

    await expect(
      audit.log({
        jobId: invalidJobId,
        actor: 'system',
        action: 'test.uuid-cast',
        target: 'test-target',
        mutated: false,
      }),
    ).resolves.toBeUndefined(); // silently swallows the DB error, does not throw

    // Verify nothing was written — query by action instead of job_id
    // to avoid a second UUID cast error at the query level
    const { rows } = await query<{ action: string }>(
      `SELECT action FROM audit_log WHERE action = $1 LIMIT 1`,
      ['test.uuid-cast'],
    );

    expect(rows).toHaveLength(0); // nothing was written with an invalid UUID
  });
});
