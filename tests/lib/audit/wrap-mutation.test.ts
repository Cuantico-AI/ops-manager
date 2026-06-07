import { describe, expect, it } from 'vitest';
import type { AuditEntry, AuditLogger } from '../../../src/lib/audit/log.js';
import { wrapMutation } from '../../../src/lib/audit/wrap-mutation.js';

function fakeAudit(): { logger: AuditLogger; entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  const logger = {
    async log(entry: AuditEntry): Promise<void> {
      entries.push(entry);
    },
  } as AuditLogger;
  return { logger, entries };
}

const baseParams = (audit: AuditLogger) => ({
  audit,
  jobId: 'job-1',
  actor: 'system',
  action: 'test.mutate',
  target: 'target-1',
  approvalId: 'approval-1',
  input: { foo: 'bar' },
});

describe('wrapMutation', () => {
  it('writes a pre-attempt (mutated:false) then a success (mutated:true) record', async () => {
    const { logger, entries } = fakeAudit();

    const result = await wrapMutation(async () => ({ id: 'done', extra: 'x' }), {
      ...baseParams(logger),
      output: (r) => ({ id: r.id }),
    });

    expect(result).toEqual({ id: 'done', extra: 'x' });
    expect(entries).toHaveLength(2);

    expect(entries[0]).toMatchObject({
      action: 'test.mutate',
      target: 'target-1',
      mutated: false,
      approvalId: 'approval-1',
      input: { foo: 'bar' },
    });
    expect(entries[0]?.output).toBeUndefined();

    expect(entries[1]).toMatchObject({
      mutated: true,
      approvalId: 'approval-1',
      output: { id: 'done' },
    });
    // success record carries no input, only the real result
    expect(entries[1]?.input).toBeUndefined();
  });

  it('writes a FAILURE record (mutated:false + error) and never a success record when the fn throws', async () => {
    const { logger, entries } = fakeAudit();
    const boom = Object.assign(new Error('refresh failed'), {
      name: 'ExternalServiceError',
      code: 'ASSISTABLE_REFRESH_FAILED',
      detail: { httpStatus: 502 },
    });

    await expect(
      wrapMutation(async () => {
        throw boom;
      }, baseParams(logger)),
    ).rejects.toBe(boom);

    // pre-attempt + failure — and crucially NO mutated:true record.
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => e.mutated === true)).toBe(false);

    const failure = entries[1];
    expect(failure).toMatchObject({
      mutated: false,
      approvalId: 'approval-1',
      input: { foo: 'bar' },
      output: {
        error: {
          name: 'ExternalServiceError',
          message: 'refresh failed',
          code: 'ASSISTABLE_REFRESH_FAILED',
          detail: { httpStatus: 502 },
        },
      },
    });
  });

  it('serializes non-Error throws on the failure record', async () => {
    const { logger, entries } = fakeAudit();

    await expect(
      wrapMutation(async () => {
        throw 'string failure';
      }, baseParams(logger)),
    ).rejects.toBe('string failure');

    expect(entries.some((e) => e.mutated === true)).toBe(false);
    expect(entries[1]?.output).toMatchObject({
      error: { name: 'UnknownError', message: 'string failure' },
    });
  });
});
