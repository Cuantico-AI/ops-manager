import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOpsAccountAttentionRunEnabled } from '../../src/jobs/ops-account-attention-run.js';
import type { OpsAccountAttentionRunSummary } from '../../src/lib/ops/account-attention-run.js';

vi.mock('../../src/lib/db/prisma.js', () => ({
  prisma: {
    jobs: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const baseSummary: OpsAccountAttentionRunSummary = {
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

afterEach(() => {
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_ENABLED;
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_HOURS;
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_LIMIT;
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS;
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_DIGEST_LIMIT;
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY;
  delete process.env.OPS_ACCOUNT_ATTENTION_RUN_CHANNEL;
  vi.doUnmock('../../src/lib/db/client.js');
});

describe('isOpsAccountAttentionRunEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.OPS_ACCOUNT_ATTENTION_RUN_ENABLED;
    expect(isOpsAccountAttentionRunEnabled()).toBe(false);

    process.env.OPS_ACCOUNT_ATTENTION_RUN_ENABLED = 'true';
    expect(isOpsAccountAttentionRunEnabled()).toBe(true);
  });
});

describe('runOpsAccountAttentionRun', () => {
  it('posts Slack output when account attention candidates exist', async () => {
    vi.resetModules();
    process.env.OPS_ACCOUNT_ATTENTION_RUN_HOURS = '12';
    process.env.OPS_ACCOUNT_ATTENTION_RUN_LIMIT = '4';
    process.env.OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS = '2';
    process.env.OPS_ACCOUNT_ATTENTION_RUN_DIGEST_LIMIT = '3';
    process.env.OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY = '2';
    process.env.OPS_ACCOUNT_ATTENTION_RUN_CHANNEL = '#ops-digest';

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const runExecute = vi.fn().mockResolvedValue({ ...baseSummary, sinceHours: 12, limit: 4 });
    const postExecute = vi.fn().mockResolvedValue({ ts: '1234.5678' });
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'ops.account-attention-run') {
          return { execute: runExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runOpsAccountAttentionRun } = await import(
      '../../src/jobs/ops-account-attention-run.js'
    );
    await runOpsAccountAttentionRun(registry as never);

    expect(runExecute).toHaveBeenCalledWith(
      {
        sinceHours: 12,
        limit: 4,
        minSignals: 2,
        accountDigestLimit: 3,
        concurrency: 2,
      },
      expect.any(Object),
    );
    expect(postExecute).toHaveBeenCalledWith(
      {
        channel: '#ops-digest',
        text: expect.stringContaining('Ops account attention run complete.'),
      },
      expect.any(Object),
    );
  });

  it('suppresses Slack posts when no accounts meet the filter', async () => {
    vi.resetModules();

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const runExecute = vi.fn().mockResolvedValue({
      ...baseSummary,
      totalCandidates: 0,
      digested: 0,
      totalAttentionSignals: 0,
      results: [],
    });
    const postExecute = vi.fn();
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'ops.account-attention-run') {
          return { execute: runExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runOpsAccountAttentionRun } = await import(
      '../../src/jobs/ops-account-attention-run.js'
    );
    await runOpsAccountAttentionRun(registry as never);

    expect(postExecute).not.toHaveBeenCalled();
  });
});
