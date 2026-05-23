import { describe, expect, it, vi } from 'vitest';
import {
  executeOpsAccountAttentionRun,
  type OpsAccountAttentionRunSummary,
} from '../../../src/lib/ops/account-attention-run.js';
import {
  opsAccountAttentionRunSkill,
  parseOpsAccountAttentionRunCommandArgs,
} from '../../../src/skills/ops/account-attention-run.js';

vi.mock('../../../src/lib/ops/account-attention-run.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/lib/ops/account-attention-run.js')>();
  return {
    ...actual,
    executeOpsAccountAttentionRun: vi.fn(),
  };
});

const summary: OpsAccountAttentionRunSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 5,
  minSignals: 2,
  accountDigestLimit: 3,
  concurrency: 2,
  fleetTotalAttentionSignals: 7,
  fleetAccountsWithAttention: 3,
  totalCandidates: 1,
  digested: 1,
  failed: 0,
  totalAttentionSignals: 3,
  results: [],
};

describe('parseOpsAccountAttentionRunCommandArgs', () => {
  it('parses defaultable empty args', () => {
    expect(parseOpsAccountAttentionRunCommandArgs('')).toEqual({});
  });
});

describe('opsAccountAttentionRunSkill', () => {
  it('audits before and after running account attention digests', async () => {
    vi.mocked(executeOpsAccountAttentionRun).mockResolvedValueOnce(summary);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    const output = await opsAccountAttentionRunSkill.execute(
      { sinceHours: 24, limit: 5, minSignals: 2 },
      {
        jobId: 'job-1',
        agentId: 'ops-digest',
        audit,
        approval: {} as never,
        llm: {} as never,
      },
    );

    expect(output.totalCandidates).toBe(1);
    expect(executeOpsAccountAttentionRun).toHaveBeenCalledWith({
      sinceHours: 24,
      limit: 5,
      minSignals: 2,
    });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[1]?.[0]).toMatchObject({
      action: 'ops.account-attention-run',
      output: {
        totalCandidates: 1,
        digested: 1,
        failed: 0,
      },
    });
  });
});
