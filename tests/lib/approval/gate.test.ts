import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalGate } from '../../../src/lib/approval/gate.js';
import { ApprovalNotImplementedError } from '../../../src/lib/errors.js';

describe('ApprovalGate', () => {
  afterEach(() => {
    delete process.env.BYPASS_APPROVAL;
  });

  it('approves when BYPASS_APPROVAL is true', async () => {
    process.env.BYPASS_APPROVAL = 'true';
    const gate = new ApprovalGate();
    const result = await gate.gate({
      jobId: '00000000-0000-4000-8000-000000000001',
      skill: 'test',
      targetSummary: 'test',
      proposedAction: {},
    });
    expect(result.status).toBe('approved');
  });

  it('throws when bypass is disabled', async () => {
    process.env.BYPASS_APPROVAL = 'false';
    const gate = new ApprovalGate();
    await expect(
      gate.gate({
        jobId: '00000000-0000-4000-8000-000000000001',
        skill: 'test',
        targetSummary: 'test',
        proposedAction: {},
      }),
    ).rejects.toBeInstanceOf(ApprovalNotImplementedError);
  });
});
