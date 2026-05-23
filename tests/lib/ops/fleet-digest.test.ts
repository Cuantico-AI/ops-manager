import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchClientCheckinFleetSummary,
  type ClientCheckinFleetSummary,
} from '../../../src/lib/client-checkin/fleet-summary.js';
import {
  fetchOpsFleetDigest,
  normalizeOpsFleetDigestHours,
  normalizeOpsFleetDigestLimit,
} from '../../../src/lib/ops/fleet-digest.js';
import {
  fetchPromptOpsFleetSummary,
  type PromptOpsFleetSummary,
} from '../../../src/lib/prompt-ops/fleet-summary.js';
import { fetchFleetQaSummary, type FleetQaSummary } from '../../../src/lib/qa/fleet-summary.js';

vi.mock('../../../src/lib/qa/fleet-summary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/qa/fleet-summary.js')>();
  return {
    ...actual,
    fetchFleetQaSummary: vi.fn(),
  };
});

vi.mock('../../../src/lib/client-checkin/fleet-summary.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/lib/client-checkin/fleet-summary.js')>();
  return {
    ...actual,
    fetchClientCheckinFleetSummary: vi.fn(),
  };
});

vi.mock('../../../src/lib/prompt-ops/fleet-summary.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/lib/prompt-ops/fleet-summary.js')>();
  return {
    ...actual,
    fetchPromptOpsFleetSummary: vi.fn(),
  };
});

const qaSummary: FleetQaSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalReviews: 3,
  passedReviews: 1,
  failedReviews: 2,
  escalatedReviews: 1,
  passRate: 33.3,
  failures: [
    {
      id: 'qa-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
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
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalReviews: 2,
      failedReviews: 2,
      averageScore: 61,
    },
  ],
  topTriggers: [
    {
      reviewTrigger: 'negative',
      totalReviews: 2,
      failedReviews: 2,
    },
  ],
};

const clientCheckinSummary: ClientCheckinFleetSummary = {
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
  recentAttention: [
    {
      id: 'brief-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
      status: 'at_risk',
      summary: 'OAuth and workflow checks need attention.',
      openIssueCount: 2,
      followUpQuestionCount: 1,
      modelUsed: 'ops-claude-sonnet',
      generatedAt: '2026-05-23T11:45:00.000Z',
    },
  ],
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalBriefs: 1,
      attentionBriefs: 1,
      latestStatus: 'at_risk',
      latestGeneratedAt: '2026-05-23T11:45:00.000Z',
    },
    {
      accountId: 'account-2',
      accountName: 'Sidecar Solar',
      totalBriefs: 1,
      attentionBriefs: 1,
      latestStatus: 'watch',
      latestGeneratedAt: '2026-05-23T10:45:00.000Z',
    },
  ],
  topIssueSystems: [
    {
      system: 'assistable',
      issueCount: 2,
    },
  ],
};

const promptOpsSummary: PromptOpsFleetSummary = {
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
  recentAttention: [
    {
      id: 'prompt-1',
      accountId: 'account-3',
      accountName: 'Northstar Dental',
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
  topAccounts: [
    {
      accountId: 'account-3',
      accountName: 'Northstar Dental',
      totalReviews: 1,
      attentionReviews: 1,
      blockedReviews: 1,
      highRiskReviews: 1,
      latestRiskLevel: 'high',
      latestBlocked: true,
      latestReviewedAt: '2026-05-23T11:15:00.000Z',
    },
  ],
  riskBreakdown: [
    {
      riskLevel: 'high',
      totalReviews: 1,
      blockedReviews: 1,
    },
  ],
};

describe('fetchOpsFleetDigest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
    vi.mocked(fetchFleetQaSummary).mockResolvedValue(qaSummary);
    vi.mocked(fetchClientCheckinFleetSummary).mockResolvedValue(clientCheckinSummary);
    vi.mocked(fetchPromptOpsFleetSummary).mockResolvedValue(promptOpsSummary);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchFleetQaSummary).mockReset();
    vi.mocked(fetchClientCheckinFleetSummary).mockReset();
    vi.mocked(fetchPromptOpsFleetSummary).mockReset();
  });

  it('combines Phase 5 fleet summaries into cross-role account signals', async () => {
    const digest = await fetchOpsFleetDigest({ sinceHours: 12, limit: 5 });

    expect(fetchFleetQaSummary).toHaveBeenCalledWith({ sinceHours: 12, limit: 5 });
    expect(fetchClientCheckinFleetSummary).toHaveBeenCalledWith({ sinceHours: 12, limit: 5 });
    expect(fetchPromptOpsFleetSummary).toHaveBeenCalledWith({ sinceHours: 12, limit: 5 });
    expect(digest.generatedAt).toBe('2026-05-23T12:00:00.000Z');
    expect(digest.totalAttentionSignals).toBe(5);
    expect(digest.accountsWithAttention).toBe(3);
    expect(digest.multiSignalAccounts).toHaveLength(1);
    expect(digest.multiSignalAccounts[0]).toMatchObject({
      accountName: 'Complete Lending',
      qaFailures: 2,
      clientCheckinAttention: 1,
      signalCategories: 2,
      attentionSignals: 3,
      latestSignalAt: '2026-05-23T11:45:00.000Z',
    });
  });
});

describe('ops fleet digest normalizers', () => {
  it('clamps hours and limits to supported ranges', () => {
    expect(normalizeOpsFleetDigestHours(undefined)).toBe(24);
    expect(normalizeOpsFleetDigestHours(0)).toBe(24);
    expect(normalizeOpsFleetDigestHours(999)).toBe(168);
    expect(normalizeOpsFleetDigestLimit(undefined)).toBe(10);
    expect(normalizeOpsFleetDigestLimit(0)).toBe(10);
    expect(normalizeOpsFleetDigestLimit(999)).toBe(25);
  });
});
