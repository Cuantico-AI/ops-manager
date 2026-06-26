import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPromptOpsFleetSummaryEnabled } from '../../src/jobs/prompt-ops-fleet-summary.js';
import type { PromptOpsFleetSummary } from '../../src/lib/prompt-ops/fleet-summary.js';

vi.mock('../../src/lib/db/prisma.js', () => ({
  prisma: {
    jobs: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const baseSummary: PromptOpsFleetSummary = {
  sinceHours: 168,
  since: '2026-05-16T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalReviews: 2,
  lowRiskReviews: 0,
  mediumRiskReviews: 0,
  highRiskReviews: 2,
  blockedReviews: 1,
  attentionReviews: 2,
  attentionRate: 100,
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalReviews: 2,
      attentionReviews: 2,
      blockedReviews: 1,
      highRiskReviews: 2,
      latestRiskLevel: 'high',
      latestBlocked: true,
      latestReviewedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
  riskBreakdown: [
    {
      riskLevel: 'high',
      totalReviews: 2,
      blockedReviews: 1,
    },
  ],
  recentAttention: [
    {
      id: 'review-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
      riskLevel: 'high',
      blocked: true,
      summary: 'Pricing compliance needs clarification before deployment.',
      recommendedChangeCount: 2,
      testPlanCount: 3,
      blockerCount: 1,
      modelUsed: 'ops-claude-sonnet',
      reviewedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
};

afterEach(() => {
  delete process.env.PROMPT_OPS_FLEET_SUMMARY_ENABLED;
  delete process.env.PROMPT_OPS_FLEET_SUMMARY_HOURS;
  delete process.env.PROMPT_OPS_FLEET_SUMMARY_CHANNEL;
  vi.doUnmock('../../src/lib/db/client.js');
});

describe('isPromptOpsFleetSummaryEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.PROMPT_OPS_FLEET_SUMMARY_ENABLED;
    expect(isPromptOpsFleetSummaryEnabled()).toBe(false);

    process.env.PROMPT_OPS_FLEET_SUMMARY_ENABLED = 'true';
    expect(isPromptOpsFleetSummaryEnabled()).toBe(true);
  });
});

describe('runPromptOpsFleetSummary', () => {
  it('posts a Slack summary when blocked or high-risk reviews exist', async () => {
    vi.resetModules();
    process.env.PROMPT_OPS_FLEET_SUMMARY_HOURS = '240';
    process.env.PROMPT_OPS_FLEET_SUMMARY_CHANNEL = '#prompt-alerts';

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const summaryExecute = vi.fn().mockResolvedValue(baseSummary);
    const postExecute = vi.fn().mockResolvedValue({ ts: '1234.5678' });
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'prompt-ops.list-fleet-risks') {
          return { execute: summaryExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runPromptOpsFleetSummary } = await import('../../src/jobs/prompt-ops-fleet-summary.js');
    await runPromptOpsFleetSummary(registry as never);

    expect(summaryExecute).toHaveBeenCalledWith({ sinceHours: 240 }, expect.any(Object));
    expect(postExecute).toHaveBeenCalledWith(
      {
        channel: '#prompt-alerts',
        text: expect.stringContaining('Prompt Ops fleet attention summary.'),
      },
      expect.any(Object),
    );
  });

  it('suppresses Slack posts when there are no blocked or high-risk reviews', async () => {
    vi.resetModules();

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const summaryExecute = vi.fn().mockResolvedValue({
      ...baseSummary,
      lowRiskReviews: 2,
      highRiskReviews: 0,
      blockedReviews: 0,
      attentionReviews: 0,
      attentionRate: 0,
      recentAttention: [],
      topAccounts: [],
      riskBreakdown: [],
    });
    const postExecute = vi.fn();
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'prompt-ops.list-fleet-risks') {
          return { execute: summaryExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runPromptOpsFleetSummary } = await import('../../src/jobs/prompt-ops-fleet-summary.js');
    await runPromptOpsFleetSummary(registry as never);

    expect(postExecute).not.toHaveBeenCalled();
  });
});
