import { describe, expect, it, vi } from 'vitest';
import {
  formatPromptOpsFleetSummaryOutput,
  parsePromptOpsFleetSummaryCommandArgs,
  promptOpsListFleetRisksSkill,
} from '../../../src/skills/prompt-ops/list-fleet-risks.js';
import {
  fetchPromptOpsFleetSummary,
  type PromptOpsFleetSummary,
} from '../../../src/lib/prompt-ops/fleet-summary.js';

vi.mock('../../../src/lib/prompt-ops/fleet-summary.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/lib/prompt-ops/fleet-summary.js')>();
  return {
    ...actual,
    fetchPromptOpsFleetSummary: vi.fn(),
  };
});

const fleetSummary: PromptOpsFleetSummary = {
  sinceHours: 168,
  since: '2026-05-16T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalReviews: 4,
  lowRiskReviews: 1,
  mediumRiskReviews: 1,
  highRiskReviews: 2,
  blockedReviews: 1,
  attentionReviews: 2,
  attentionRate: 50,
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalReviews: 3,
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

describe('parsePromptOpsFleetSummaryCommandArgs', () => {
  it('defaults to the standard window with no args', () => {
    expect(parsePromptOpsFleetSummaryCommandArgs('')).toEqual({
      sinceHours: undefined,
      limit: undefined,
    });
  });

  it('parses a trailing hour window and limit flag', () => {
    expect(parsePromptOpsFleetSummaryCommandArgs('240 --limit=5')).toEqual({
      sinceHours: 240,
      limit: 5,
    });
  });

  it('rejects unknown tokens', () => {
    expect(() => parsePromptOpsFleetSummaryCommandArgs('Complete Lending')).toThrow(
      /prompt-fleet-summary/,
    );
  });
});

describe('formatPromptOpsFleetSummaryOutput', () => {
  it('formats fleet attention without exposing raw prompt context', () => {
    const text = formatPromptOpsFleetSummaryOutput(fleetSummary);

    expect(text).toContain('Prompt Ops fleet attention summary.');
    expect(text).toContain('Reviews: 4');
    expect(text).toContain('Attention rate: 50.0%');
    expect(text).toContain('Complete Lending: 2 attention review(s) / 3 total');
    expect(text).toContain('HIGH: 2 review(s), 1 blocked');
    expect(text).toContain('review-1');
    expect(text).not.toContain('current prompt');
    expect(text).not.toContain('conversation sample');
    expect(text).not.toContain('secret:');
  });

  it('formats an empty review window', () => {
    const text = formatPromptOpsFleetSummaryOutput({
      ...fleetSummary,
      totalReviews: 0,
      lowRiskReviews: 0,
      mediumRiskReviews: 0,
      highRiskReviews: 0,
      blockedReviews: 0,
      attentionReviews: 0,
      attentionRate: 0,
      recentAttention: [],
      topAccounts: [],
      riskBreakdown: [],
    });

    expect(text).toContain('No Prompt Ops reviews found in this window.');
  });
});

describe('promptOpsListFleetRisksSkill', () => {
  it('audits before and after fetching fleet Prompt Ops risks', async () => {
    vi.mocked(fetchPromptOpsFleetSummary).mockResolvedValueOnce(fleetSummary);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    const output = await promptOpsListFleetRisksSkill.execute(
      { sinceHours: 168 },
      {
        jobId: 'job-1',
        agentId: 'prompt-ops',
        audit,
        approval: {} as never,
        llm: {} as never,
      },
    );

    expect(output.attentionReviews).toBe(2);
    expect(fetchPromptOpsFleetSummary).toHaveBeenCalledWith({ sinceHours: 168 });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[1]?.[0]).toMatchObject({
      action: 'prompt-ops.list-fleet-risks',
      output: {
        totalReviews: 4,
        blockedReviews: 1,
        highRiskReviews: 2,
        attentionReviews: 2,
        recentAttentionCount: 1,
      },
    });
  });
});
