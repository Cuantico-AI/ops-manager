import { describe, expect, it, vi } from 'vitest';
import {
  fetchOpsAccountDigest,
  type OpsAccountDigestSummary,
} from '../../../src/lib/ops/account-digest.js';
import {
  formatOpsAccountDigestOutput,
  opsAccountDigestSkill,
  parseOpsAccountDigestCommandArgs,
} from '../../../src/skills/ops/account-digest.js';

vi.mock('../../../src/lib/ops/account-digest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/ops/account-digest.js')>();
  return {
    ...actual,
    fetchOpsAccountDigest: vi.fn(),
  };
});

const digest: OpsAccountDigestSummary = {
  accountId: '11111111-1111-4111-8111-111111111111',
  accountName: 'Complete Lending',
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  qa: {
    totalReviews: 3,
    passedReviews: 1,
    failedReviews: 2,
    escalatedReviews: 1,
    averageScore: 70,
    passRate: 33.3,
    failures: [
      {
        id: 'qa-1',
        callId: 'call_123',
        reviewTrigger: 'negative',
        score: 62,
        callType: 'inbound',
        summary: 'Caller had unresolved objections.',
        findingCount: 2,
        modelUsed: 'ops-claude-sonnet',
        escalated: true,
        reviewedAt: '2026-05-23T11:30:00.000Z',
      },
    ],
    topTriggers: [
      {
        reviewTrigger: 'negative',
        totalReviews: 2,
        failedReviews: 2,
      },
    ],
  },
  clientCheckin: {
    totalBriefs: 2,
    healthyBriefs: 0,
    watchBriefs: 1,
    atRiskBriefs: 1,
    attentionBriefs: 2,
    attentionRate: 100,
    recentAttention: [
      {
        id: 'brief-1',
        status: 'at_risk',
        summary: 'OAuth and workflow checks need attention.',
        openIssueCount: 2,
        followUpQuestionCount: 1,
        modelUsed: 'ops-claude-sonnet',
        generatedAt: '2026-05-23T11:45:00.000Z',
      },
    ],
    topIssueSystems: [
      {
        system: 'assistable',
        issueCount: 2,
      },
    ],
  },
  promptOps: {
    totalReviews: 2,
    lowRiskReviews: 0,
    mediumRiskReviews: 1,
    highRiskReviews: 1,
    blockedReviews: 1,
    attentionReviews: 1,
    attentionRate: 50,
    recentAttention: [
      {
        id: 'prompt-1',
        riskLevel: 'high',
        blocked: true,
        summary: 'Needs more samples before prompt rollout.',
        recommendedChangeCount: 1,
        testPlanCount: 2,
        blockerCount: 1,
        modelUsed: 'ops-claude-sonnet',
        reviewedAt: '2026-05-23T11:15:00.000Z',
      },
    ],
    riskBreakdown: [
      {
        riskLevel: 'high',
        totalReviews: 1,
        blockedReviews: 1,
      },
    ],
  },
  signalCategories: 3,
  totalAttentionSignals: 5,
  latestSignalAt: '2026-05-23T11:45:00.000Z',
};

describe('parseOpsAccountDigestCommandArgs', () => {
  it('parses an account name with trailing hour window and limit flag', () => {
    expect(parseOpsAccountDigestCommandArgs('Complete Lending 48 --limit=5')).toEqual({
      accountQuery: 'Complete Lending',
      sinceHours: 48,
      limit: 5,
    });
  });

  it('parses an explicit hour flag', () => {
    expect(parseOpsAccountDigestCommandArgs('Complete Lending --hours=72')).toEqual({
      accountQuery: 'Complete Lending',
      sinceHours: 72,
      limit: undefined,
    });
  });

  it('requires an account name', () => {
    expect(() => parseOpsAccountDigestCommandArgs('48 --limit=5')).toThrow(/account-digest/);
  });
});

describe('formatOpsAccountDigestOutput', () => {
  it('formats one-account attention without raw operational payloads', () => {
    const text = formatOpsAccountDigestOutput(digest);

    expect(text).toContain('Ops account attention digest.');
    expect(text).toContain('Account: Complete Lending');
    expect(text).toContain('QA reviews: 3; failed: 2; pass rate: 33.3%');
    expect(text).toContain('Recent QA failures');
    expect(text).toContain('Recent client check-in attention');
    expect(text).toContain('Recent Prompt Ops attention');
    expect(text).toContain('assistable: 2 issue(s)');
    expect(text).toContain('HIGH: 1 review(s), 1 blocked');
    expect(text).not.toContain('Quote:');
    expect(text).not.toContain('Transcript:');
    expect(text).not.toContain('secret');
  });

  it('formats an empty account digest window', () => {
    const text = formatOpsAccountDigestOutput({
      ...digest,
      totalAttentionSignals: 0,
      signalCategories: 0,
      latestSignalAt: null,
      qa: {
        ...digest.qa,
        totalReviews: 0,
        passedReviews: 0,
        failedReviews: 0,
        escalatedReviews: 0,
        averageScore: null,
        passRate: 0,
        failures: [],
        topTriggers: [],
      },
      clientCheckin: {
        ...digest.clientCheckin,
        totalBriefs: 0,
        healthyBriefs: 0,
        watchBriefs: 0,
        atRiskBriefs: 0,
        attentionBriefs: 0,
        attentionRate: 0,
        recentAttention: [],
        topIssueSystems: [],
      },
      promptOps: {
        ...digest.promptOps,
        totalReviews: 0,
        lowRiskReviews: 0,
        mediumRiskReviews: 0,
        highRiskReviews: 0,
        blockedReviews: 0,
        attentionReviews: 0,
        attentionRate: 0,
        recentAttention: [],
        riskBreakdown: [],
      },
    });

    expect(text).toContain('No Phase 5 attention signals found for this account in this window.');
  });
});

describe('opsAccountDigestSkill', () => {
  it('audits before and after fetching the digest', async () => {
    vi.mocked(fetchOpsAccountDigest).mockResolvedValueOnce(digest);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    const output = await opsAccountDigestSkill.execute(
      { accountQuery: 'Complete Lending', sinceHours: 24 },
      {
        jobId: 'job-1',
        agentId: 'ops-digest',
        audit,
        approval: {} as never,
        llm: {} as never,
      },
    );

    expect(output.totalAttentionSignals).toBe(5);
    expect(fetchOpsAccountDigest).toHaveBeenCalledWith({
      accountQuery: 'Complete Lending',
      sinceHours: 24,
    });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[1]?.[0]).toMatchObject({
      action: 'ops.account-digest',
      target: '11111111-1111-4111-8111-111111111111',
      output: {
        accountName: 'Complete Lending',
        totalAttentionSignals: 5,
        signalCategories: 3,
      },
    });
  });
});
