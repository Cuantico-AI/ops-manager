import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOpsFleetDigestEnabled } from '../../src/jobs/ops-fleet-digest.js';
import type { OpsFleetDigestSummary } from '../../src/lib/ops/fleet-digest.js';

vi.mock('../../src/lib/db/prisma.js', () => ({
  prisma: {
    jobs: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const baseDigest: OpsFleetDigestSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  qa: {
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 10,
    totalReviews: 2,
    passedReviews: 1,
    failedReviews: 1,
    escalatedReviews: 1,
    passRate: 50,
    failures: [],
    topAccounts: [],
    topTriggers: [],
  },
  clientCheckin: {
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 10,
    totalBriefs: 1,
    healthyBriefs: 0,
    watchBriefs: 1,
    atRiskBriefs: 0,
    attentionBriefs: 1,
    attentionRate: 100,
    recentAttention: [],
    topAccounts: [],
    topIssueSystems: [],
  },
  promptOps: {
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 10,
    totalReviews: 1,
    lowRiskReviews: 0,
    mediumRiskReviews: 0,
    highRiskReviews: 1,
    blockedReviews: 1,
    attentionReviews: 1,
    attentionRate: 100,
    recentAttention: [],
    topAccounts: [],
    riskBreakdown: [],
  },
  totalAttentionSignals: 3,
  accountsWithAttention: 2,
  multiSignalAccounts: [],
  topAccounts: [],
};

afterEach(() => {
  delete process.env.OPS_FLEET_DIGEST_ENABLED;
  delete process.env.OPS_FLEET_DIGEST_HOURS;
  delete process.env.OPS_FLEET_DIGEST_CHANNEL;
  vi.doUnmock('../../src/lib/db/client.js');
});

describe('isOpsFleetDigestEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.OPS_FLEET_DIGEST_ENABLED;
    expect(isOpsFleetDigestEnabled()).toBe(false);

    process.env.OPS_FLEET_DIGEST_ENABLED = 'true';
    expect(isOpsFleetDigestEnabled()).toBe(true);
  });
});

describe('runOpsFleetDigest', () => {
  it('posts a Slack digest when attention signals exist', async () => {
    vi.resetModules();
    process.env.OPS_FLEET_DIGEST_HOURS = '12';
    process.env.OPS_FLEET_DIGEST_CHANNEL = '#ops-digest';

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const digestExecute = vi.fn().mockResolvedValue(baseDigest);
    const postExecute = vi.fn().mockResolvedValue({ ts: '1234.5678' });
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'ops.fleet-digest') {
          return { execute: digestExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runOpsFleetDigest } = await import('../../src/jobs/ops-fleet-digest.js');
    await runOpsFleetDigest(registry as never);

    expect(digestExecute).toHaveBeenCalledWith({ sinceHours: 12 }, expect.any(Object));
    expect(postExecute).toHaveBeenCalledWith(
      {
        channel: '#ops-digest',
        text: expect.stringContaining('Ops fleet attention digest.'),
      },
      expect.any(Object),
    );
  });

  it('suppresses Slack posts when there are no attention signals', async () => {
    vi.resetModules();

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const digestExecute = vi.fn().mockResolvedValue({
      ...baseDigest,
      totalAttentionSignals: 0,
      accountsWithAttention: 0,
      multiSignalAccounts: [],
      topAccounts: [],
    });
    const postExecute = vi.fn();
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'ops.fleet-digest') {
          return { execute: digestExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runOpsFleetDigest } = await import('../../src/jobs/ops-fleet-digest.js');
    await runOpsFleetDigest(registry as never);

    expect(postExecute).not.toHaveBeenCalled();
  });
});
