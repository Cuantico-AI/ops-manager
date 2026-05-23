import { describe, expect, it, vi } from 'vitest';
import {
  executeOpsAccountAttentionRun,
  formatOpsAccountAttentionRunOutput,
  parseOpsAccountAttentionRunCommandArgs,
  selectOpsAccountAttentionCandidates,
  type OpsAccountAttentionRunSummary,
} from '../../../src/lib/ops/account-attention-run.js';
import type { OpsAccountDigestSummary } from '../../../src/lib/ops/account-digest.js';
import type { OpsFleetDigestAccountSignal } from '../../../src/lib/ops/fleet-digest.js';

const account1 = makeSignal({
  accountId: '11111111-1111-4111-8111-111111111111',
  accountName: 'Complete Lending',
  qaFailures: 2,
  qaReviews: 3,
  clientCheckinAttention: 1,
  clientCheckinBriefs: 1,
  promptOpsAttention: 0,
  promptOpsReviews: 0,
  signalCategories: 2,
  attentionSignals: 3,
  latestSignalAt: '2026-05-23T11:45:00.000Z',
});
const account2 = makeSignal({
  accountId: '22222222-2222-4222-8222-222222222222',
  accountName: 'Acme Dental',
  qaFailures: 1,
  qaReviews: 1,
  clientCheckinAttention: 1,
  clientCheckinBriefs: 1,
  promptOpsAttention: 1,
  promptOpsReviews: 1,
  signalCategories: 3,
  attentionSignals: 3,
  latestSignalAt: '2026-05-23T11:30:00.000Z',
});
const account3 = makeSignal({
  accountId: '33333333-3333-4333-8333-333333333333',
  accountName: 'Solo Signal',
  qaFailures: 1,
  qaReviews: 1,
  clientCheckinAttention: 0,
  clientCheckinBriefs: 0,
  promptOpsAttention: 0,
  promptOpsReviews: 0,
  signalCategories: 1,
  attentionSignals: 1,
  latestSignalAt: '2026-05-23T11:00:00.000Z',
});

describe('selectOpsAccountAttentionCandidates', () => {
  it('selects accounts meeting the minimum signal category threshold', () => {
    const candidates = selectOpsAccountAttentionCandidates({
      multiSignalAccounts: [account1, account2],
      topAccounts: [account3, account1],
      minSignals: 2,
      limit: 5,
    });

    expect(candidates.map((candidate) => candidate.accountName)).toEqual([
      'Acme Dental',
      'Complete Lending',
    ]);
  });
});

describe('parseOpsAccountAttentionRunCommandArgs', () => {
  it('parses hours and run controls', () => {
    expect(
      parseOpsAccountAttentionRunCommandArgs(
        '48 --limit=4 --min-signals=1 --digest-limit=3 --concurrency=2',
      ),
    ).toEqual({
      sinceHours: 48,
      limit: 4,
      minSignals: 1,
      accountDigestLimit: 3,
      concurrency: 2,
    });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseOpsAccountAttentionRunCommandArgs('Complete Lending')).toThrow(
      /account-attention-run/,
    );
  });
});

describe('executeOpsAccountAttentionRun', () => {
  it('fetches compact account digests for selected fleet attention accounts', async () => {
    const fetchFleetDigest = vi.fn().mockResolvedValue({
      since: '2026-05-22T12:00:00.000Z',
      generatedAt: '2026-05-23T12:00:00.000Z',
      totalAttentionSignals: 7,
      accountsWithAttention: 3,
      multiSignalAccounts: [account1, account2],
      topAccounts: [account3, account1, account2],
    });
    const fetchAccountDigest = vi.fn(async ({ accountId }) => {
      if (accountId === account2.accountId) {
        return makeDigest(account2);
      }
      return makeDigest(account1);
    });

    const summary = await executeOpsAccountAttentionRun({
      sinceHours: 24,
      limit: 5,
      minSignals: 2,
      accountDigestLimit: 3,
      concurrency: 2,
      fetchFleetDigest,
      fetchAccountDigest,
    });

    expect(fetchFleetDigest).toHaveBeenCalledWith({ sinceHours: 24, limit: 5 });
    expect(fetchAccountDigest).toHaveBeenCalledTimes(2);
    expect(fetchAccountDigest).toHaveBeenCalledWith({
      accountId: account2.accountId,
      sinceHours: 24,
      limit: 3,
    });
    expect(summary).toMatchObject({
      totalCandidates: 2,
      digested: 2,
      failed: 0,
      totalAttentionSignals: 6,
    });
  });

  it('records per-account failures without failing the whole run', async () => {
    const fetchFleetDigest = vi.fn().mockResolvedValue({
      since: '2026-05-22T12:00:00.000Z',
      generatedAt: '2026-05-23T12:00:00.000Z',
      totalAttentionSignals: 3,
      accountsWithAttention: 1,
      multiSignalAccounts: [account1],
      topAccounts: [account1],
    });
    const fetchAccountDigest = vi.fn().mockRejectedValue(new Error('account missing'));

    const summary = await executeOpsAccountAttentionRun({
      fetchFleetDigest,
      fetchAccountDigest,
    });

    expect(summary).toMatchObject({
      totalCandidates: 1,
      digested: 0,
      failed: 1,
    });
    expect(summary.results[0]).toMatchObject({
      action: 'failed',
      accountName: 'Complete Lending',
      error: 'account missing',
    });
  });
});

describe('formatOpsAccountAttentionRunOutput', () => {
  it('formats account digest summaries without raw operational payloads', () => {
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
      results: [
        {
          accountId: account1.accountId,
          accountName: account1.accountName,
          action: 'digested',
          candidate: account1,
          digest: makeDigest(account1),
        },
      ],
    };

    const text = formatOpsAccountAttentionRunOutput(summary);

    expect(text).toContain('Ops account attention run complete.');
    expect(text).toContain('Complete Lending: 3 signal(s) across 2 area(s)');
    expect(text).toContain('QA failures 2/3; check-ins 1/1; Prompt Ops 0/0');
    expect(text).not.toContain('Transcript:');
    expect(text).not.toContain('Quote:');
    expect(text).not.toContain('secret');
  });

  it('formats an empty run', () => {
    const text = formatOpsAccountAttentionRunOutput({
      sinceHours: 24,
      since: '2026-05-22T12:00:00.000Z',
      generatedAt: '2026-05-23T12:00:00.000Z',
      limit: 5,
      minSignals: 2,
      accountDigestLimit: 3,
      concurrency: 2,
      fleetTotalAttentionSignals: 1,
      fleetAccountsWithAttention: 1,
      totalCandidates: 0,
      digested: 0,
      failed: 0,
      totalAttentionSignals: 0,
      results: [],
    });

    expect(text).toContain('No accounts met the attention filter in this window.');
  });
});

function makeSignal(input: OpsFleetDigestAccountSignal): OpsFleetDigestAccountSignal {
  return input;
}

function makeDigest(signal: OpsFleetDigestAccountSignal): OpsAccountDigestSummary {
  return {
    accountId: signal.accountId,
    accountName: signal.accountName,
    sinceHours: 24,
    since: '2026-05-22T12:00:00.000Z',
    generatedAt: '2026-05-23T12:00:00.000Z',
    limit: 3,
    qa: {
      totalReviews: signal.qaReviews,
      passedReviews: Math.max(signal.qaReviews - signal.qaFailures, 0),
      failedReviews: signal.qaFailures,
      escalatedReviews: 0,
      averageScore: signal.qaReviews > 0 ? 70 : null,
      passRate: 50,
      failures: [],
      topTriggers: [],
    },
    clientCheckin: {
      totalBriefs: signal.clientCheckinBriefs,
      healthyBriefs: Math.max(signal.clientCheckinBriefs - signal.clientCheckinAttention, 0),
      watchBriefs: signal.clientCheckinAttention,
      atRiskBriefs: 0,
      attentionBriefs: signal.clientCheckinAttention,
      attentionRate: signal.clientCheckinBriefs > 0 ? 100 : 0,
      recentAttention: [],
      topIssueSystems: [],
    },
    promptOps: {
      totalReviews: signal.promptOpsReviews,
      lowRiskReviews: 0,
      mediumRiskReviews: 0,
      highRiskReviews: signal.promptOpsAttention,
      blockedReviews: 0,
      attentionReviews: signal.promptOpsAttention,
      attentionRate: signal.promptOpsReviews > 0 ? 100 : 0,
      recentAttention: [],
      riskBreakdown: [],
    },
    signalCategories: signal.signalCategories,
    totalAttentionSignals: signal.attentionSignals,
    latestSignalAt: signal.latestSignalAt,
  };
}
