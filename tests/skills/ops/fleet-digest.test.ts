import { describe, expect, it, vi } from 'vitest';
import {
  fetchOpsFleetDigest,
  type OpsFleetDigestSummary,
} from '../../../src/lib/ops/fleet-digest.js';
import {
  formatOpsFleetDigestOutput,
  opsFleetDigestSkill,
  parseOpsFleetDigestCommandArgs,
} from '../../../src/skills/ops/fleet-digest.js';

vi.mock('../../../src/lib/ops/fleet-digest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/ops/fleet-digest.js')>();
  return {
    ...actual,
    fetchOpsFleetDigest: vi.fn(),
  };
});

const digest: OpsFleetDigestSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  qa: {
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 10,
    totalReviews: 3,
    passedReviews: 1,
    failedReviews: 2,
    escalatedReviews: 1,
    passRate: 33.3,
    failures: [],
    topAccounts: [],
    topTriggers: [
      {
        reviewTrigger: 'negative',
        totalReviews: 2,
        failedReviews: 2,
      },
    ],
  },
  clientCheckin: {
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 10,
    totalBriefs: 2,
    healthyBriefs: 0,
    watchBriefs: 1,
    atRiskBriefs: 1,
    attentionBriefs: 2,
    attentionRate: 100,
    recentAttention: [],
    topAccounts: [],
    topIssueSystems: [
      {
        system: 'assistable',
        issueCount: 2,
      },
    ],
  },
  promptOps: {
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 10,
    totalReviews: 2,
    lowRiskReviews: 0,
    mediumRiskReviews: 1,
    highRiskReviews: 1,
    blockedReviews: 1,
    attentionReviews: 1,
    attentionRate: 50,
    recentAttention: [],
    topAccounts: [],
    riskBreakdown: [
      {
        riskLevel: 'high',
        totalReviews: 1,
        blockedReviews: 1,
      },
    ],
  },
  totalAttentionSignals: 5,
  accountsWithAttention: 2,
  multiSignalAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      qaFailures: 2,
      qaReviews: 2,
      clientCheckinAttention: 1,
      clientCheckinBriefs: 1,
      promptOpsAttention: 0,
      promptOpsReviews: 0,
      signalCategories: 2,
      attentionSignals: 3,
      latestSignalAt: '2026-05-23T11:45:00.000Z',
    },
  ],
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      qaFailures: 2,
      qaReviews: 2,
      clientCheckinAttention: 1,
      clientCheckinBriefs: 1,
      promptOpsAttention: 0,
      promptOpsReviews: 0,
      signalCategories: 2,
      attentionSignals: 3,
      latestSignalAt: '2026-05-23T11:45:00.000Z',
    },
  ],
};

describe('parseOpsFleetDigestCommandArgs', () => {
  it('defaults to the standard window with no args', () => {
    expect(parseOpsFleetDigestCommandArgs('')).toEqual({
      sinceHours: undefined,
      limit: undefined,
    });
  });

  it('parses a trailing hour window and limit flag', () => {
    expect(parseOpsFleetDigestCommandArgs('48 --limit=5')).toEqual({
      sinceHours: 48,
      limit: 5,
    });
  });

  it('rejects unknown tokens', () => {
    expect(() => parseOpsFleetDigestCommandArgs('Complete Lending')).toThrow(/fleet-digest/);
  });
});

describe('formatOpsFleetDigestOutput', () => {
  it('formats cross-role fleet attention without raw operational payloads', () => {
    const text = formatOpsFleetDigestOutput(digest);

    expect(text).toContain('Ops fleet attention digest.');
    expect(text).toContain('QA reviews: 3; failed: 2; pass rate: 33.3%');
    expect(text).toContain('Complete Lending: 3 signal(s) across 2 area(s)');
    expect(text).toContain('QA failure triggers:');
    expect(text).toContain('assistable: 2 issue(s)');
    expect(text).toContain('HIGH: 1 review(s), 1 blocked');
    expect(text).not.toContain('Quote:');
    expect(text).not.toContain('Transcript:');
    expect(text).not.toContain('secret');
  });

  it('formats an empty digest window', () => {
    const text = formatOpsFleetDigestOutput({
      ...digest,
      totalAttentionSignals: 0,
      accountsWithAttention: 0,
      multiSignalAccounts: [],
      topAccounts: [],
      qa: {
        ...digest.qa,
        totalReviews: 0,
        passedReviews: 0,
        failedReviews: 0,
        escalatedReviews: 0,
        passRate: 0,
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
        riskBreakdown: [],
      },
    });

    expect(text).toContain('No Phase 5 fleet attention signals found in this window.');
  });
});

describe('opsFleetDigestSkill', () => {
  it('audits before and after fetching the digest', async () => {
    vi.mocked(fetchOpsFleetDigest).mockResolvedValueOnce(digest);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    const output = await opsFleetDigestSkill.execute(
      { sinceHours: 24 },
      {
        jobId: 'job-1',
        agentId: 'ops-digest',
        audit,
        approval: {} as never,
        llm: {} as never,
      },
    );

    expect(output.totalAttentionSignals).toBe(5);
    expect(fetchOpsFleetDigest).toHaveBeenCalledWith({ sinceHours: 24 });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[1]?.[0]).toMatchObject({
      action: 'ops.fleet-digest',
      output: {
        totalAttentionSignals: 5,
        accountsWithAttention: 2,
        multiSignalAccounts: 1,
      },
    });
  });
});
