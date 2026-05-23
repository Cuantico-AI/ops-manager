import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import { ValidationError } from '../../../src/lib/errors.js';
import {
  executeClientCheckinAttentionSweep,
  fetchLatestClientCheckinBriefsForAccounts,
  formatClientCheckinAttentionSweepOutput,
  normalizeClientCheckinAttentionSweepConcurrency,
  normalizeClientCheckinAttentionSweepLimit,
  normalizeClientCheckinAttentionSweepMinHours,
  normalizeClientCheckinAttentionSweepMinSignals,
  normalizeClientCheckinAttentionSweepSinceHours,
  parseClientCheckinAttentionSweepCommandArgs,
} from '../../../src/lib/client-checkin/attention-sweep.js';
import type { OpsFleetDigestAccountSignal } from '../../../src/lib/ops/fleet-digest.js';
import type { GenerateClientCheckinBriefOutput } from '../../../src/skills/client-checkin/generate-brief.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

const accountOneId = '11111111-1111-4111-8111-111111111111';
const accountTwoId = '22222222-2222-4222-8222-222222222222';
const accountThreeId = '33333333-3333-4333-8333-333333333333';

describe('fetchLatestClientCheckinBriefsForAccounts', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('returns latest brief timestamps keyed by account ID', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          account_id: accountOneId,
          generated_at: new Date('2026-05-23T10:00:00.000Z'),
        },
      ],
    } as never);

    const latest = await fetchLatestClientCheckinBriefsForAccounts([accountOneId]);

    expect(latest.get(accountOneId)).toBe('2026-05-23T10:00:00.000Z');
    expect(vi.mocked(query).mock.calls[0]?.[1]).toEqual([[accountOneId]]);
  });

  it('does not query when there are no account IDs', async () => {
    const latest = await fetchLatestClientCheckinBriefsForAccounts([]);

    expect(latest.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('executeClientCheckinAttentionSweep', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates stale attention briefs, skips recent briefs, and isolates failures', async () => {
    const staleCandidate = makeSignal({
      accountId: accountOneId,
      accountName: 'Complete Lending',
      qaFailures: 2,
      clientCheckinAttention: 0,
      promptOpsAttention: 1,
      signalCategories: 2,
      attentionSignals: 3,
    });
    const recentCandidate = makeSignal({
      accountId: accountTwoId,
      accountName: 'Fresh Account',
      qaFailures: 1,
      clientCheckinAttention: 1,
      promptOpsAttention: 0,
      signalCategories: 2,
      attentionSignals: 2,
    });
    const failingCandidate = makeSignal({
      accountId: accountThreeId,
      accountName: 'Broken Account',
      qaFailures: 1,
      clientCheckinAttention: 0,
      promptOpsAttention: 1,
      signalCategories: 2,
      attentionSignals: 2,
    });
    const fetchFleetDigest = vi.fn().mockResolvedValue({
      since: '2026-05-22T12:00:00.000Z',
      totalAttentionSignals: 7,
      accountsWithAttention: 3,
      multiSignalAccounts: [staleCandidate, recentCandidate, failingCandidate],
      topAccounts: [],
    });
    const fetchLatestBriefs = vi.fn().mockResolvedValue(
      new Map([
        [accountOneId, '2026-05-21T12:00:00.000Z'],
        [accountTwoId, '2026-05-23T06:00:00.000Z'],
      ]),
    );
    const generateBrief = vi
      .fn()
      .mockResolvedValueOnce(makeBrief(accountOneId, 'Complete Lending', 'watch'))
      .mockRejectedValueOnce(new Error('model unavailable'));
    const persistBrief = vi.fn().mockResolvedValueOnce({
      id: 'brief-1',
    });

    const summary = await executeClientCheckinAttentionSweep({
      jobId: 'job-1',
      ctx: {
        jobId: 'job-1',
        agentId: 'client-checkin',
        audit: {} as never,
        approval: {} as never,
        llm: {} as never,
      },
      sinceHours: 24,
      minSignals: 2,
      minHours: 24,
      limit: 5,
      concurrency: 2,
      model: 'ops-claude-haiku',
      fetchFleetDigest,
      fetchLatestBriefs,
      generateBrief,
      persistBrief,
    });

    expect(fetchFleetDigest).toHaveBeenCalledWith({ sinceHours: 24, limit: 5 });
    expect(fetchLatestBriefs).toHaveBeenCalledWith([accountOneId, accountThreeId, accountTwoId]);
    expect(generateBrief).toHaveBeenCalledTimes(2);
    expect(generateBrief).toHaveBeenCalledWith(
      { accountId: accountOneId, includeInactive: true, model: 'ops-claude-haiku' },
      expect.any(Object),
    );
    expect(persistBrief).toHaveBeenCalledWith({
      jobId: 'job-1',
      output: expect.objectContaining({ accountId: accountOneId, status: 'watch' }),
    });
    expect(summary).toMatchObject({
      totalCandidates: 3,
      generated: 1,
      skippedRecent: 1,
      failed: 1,
      watchBriefs: 1,
      attentionBriefs: 1,
    });
    expect(summary.results.map((result) => result.action)).toEqual([
      'generated',
      'failed',
      'skipped_recent',
    ]);
  });

  it('respects the minimum signal filter before checking brief freshness', async () => {
    const fetchFleetDigest = vi.fn().mockResolvedValue({
      since: '2026-05-22T12:00:00.000Z',
      totalAttentionSignals: 1,
      accountsWithAttention: 1,
      multiSignalAccounts: [],
      topAccounts: [
        makeSignal({
          accountId: accountOneId,
          accountName: 'Solo Signal',
          qaFailures: 1,
          clientCheckinAttention: 0,
          promptOpsAttention: 0,
          signalCategories: 1,
          attentionSignals: 1,
        }),
      ],
    });
    const fetchLatestBriefs = vi.fn();
    const generateBrief = vi.fn();

    const summary = await executeClientCheckinAttentionSweep({
      jobId: 'job-1',
      ctx: {
        jobId: 'job-1',
        agentId: 'client-checkin',
        audit: {} as never,
        approval: {} as never,
        llm: {} as never,
      },
      minSignals: 2,
      fetchFleetDigest,
      fetchLatestBriefs,
      generateBrief,
    });

    expect(summary.totalCandidates).toBe(0);
    expect(fetchLatestBriefs).toHaveBeenCalledWith([]);
    expect(generateBrief).not.toHaveBeenCalled();
  });
});

describe('client check-in attention sweep parser and formatter', () => {
  it('parses attention sweep controls', () => {
    expect(
      parseClientCheckinAttentionSweepCommandArgs(
        '48 --limit=4 --min-signals=1 --min-hours=12 --concurrency=2',
      ),
    ).toEqual({
      sinceHours: 48,
      limit: 4,
      minSignals: 1,
      minHours: 12,
      concurrency: 2,
    });
  });

  it('rejects unknown tokens', () => {
    expect(() => parseClientCheckinAttentionSweepCommandArgs('Complete Lending')).toThrow(
      ValidationError,
    );
  });

  it('formats generated counts without exposing raw signal payloads or secrets', () => {
    const text = formatClientCheckinAttentionSweepOutput({
      sinceHours: 24,
      since: '2026-05-22T12:00:00.000Z',
      minSignals: 2,
      minHours: 24,
      limit: 5,
      concurrency: 2,
      startedAt: '2026-05-23T12:00:00.000Z',
      completedAt: '2026-05-23T12:01:00.000Z',
      fleetTotalAttentionSignals: 3,
      fleetAccountsWithAttention: 1,
      totalCandidates: 1,
      generated: 1,
      skippedRecent: 0,
      failed: 0,
      healthyBriefs: 0,
      watchBriefs: 1,
      atRiskBriefs: 0,
      attentionBriefs: 1,
      results: [
        {
          accountId: accountOneId,
          accountName: 'Complete Lending',
          action: 'generated',
          signalCategories: 2,
          attentionSignals: 3,
          briefId: 'brief-1',
          status: 'watch',
          generatedAt: '2026-05-23T12:00:00.000Z',
          openIssueCount: 1,
          followUpQuestionCount: 1,
        },
      ],
    });

    expect(text).toContain('Client check-in attention sweep complete.');
    expect(text).toContain('Complete Lending');
    expect(text).toContain('brief-1');
    expect(text).not.toContain('signals:');
    expect(text).not.toContain('pit_');
    expect(text).not.toContain('secret:');
  });
});

describe('client check-in attention sweep normalizers', () => {
  it('clamps controls to supported ranges', () => {
    expect(normalizeClientCheckinAttentionSweepSinceHours(undefined)).toBe(24);
    expect(normalizeClientCheckinAttentionSweepSinceHours(999)).toBe(168);
    expect(normalizeClientCheckinAttentionSweepLimit(undefined)).toBe(5);
    expect(normalizeClientCheckinAttentionSweepLimit(999)).toBe(25);
    expect(normalizeClientCheckinAttentionSweepMinSignals(undefined)).toBe(2);
    expect(normalizeClientCheckinAttentionSweepMinSignals(999)).toBe(3);
    expect(normalizeClientCheckinAttentionSweepMinHours(undefined)).toBe(24);
    expect(normalizeClientCheckinAttentionSweepMinHours(999)).toBe(720);
    expect(normalizeClientCheckinAttentionSweepConcurrency(undefined)).toBe(3);
    expect(normalizeClientCheckinAttentionSweepConcurrency(999)).toBe(10);
  });
});

function makeSignal(
  input: Pick<
    OpsFleetDigestAccountSignal,
    | 'accountId'
    | 'accountName'
    | 'qaFailures'
    | 'clientCheckinAttention'
    | 'promptOpsAttention'
    | 'signalCategories'
    | 'attentionSignals'
  >,
): OpsFleetDigestAccountSignal {
  return {
    ...input,
    qaReviews: input.qaFailures,
    clientCheckinBriefs: input.clientCheckinAttention,
    promptOpsReviews: input.promptOpsAttention,
    latestSignalAt: '2026-05-23T11:00:00.000Z',
  };
}

function makeBrief(
  accountId: string,
  accountName: string,
  status: GenerateClientCheckinBriefOutput['status'],
): GenerateClientCheckinBriefOutput {
  return {
    accountId,
    accountName,
    generatedAt: '2026-05-23T12:00:00.000Z',
    modelUsed: 'ops-claude-haiku',
    status,
    summary: 'Brief summary.',
    talkingPoints: ['Discuss automation health.'],
    openIssues:
      status === 'healthy'
        ? []
        : [
            {
              system: 'n8n',
              severity: 'minor',
              detail: 'One workflow needs review.',
            },
          ],
    followUpQuestions: status === 'healthy' ? [] : ['Any recent missed automations?'],
    signals: {
      accountId,
      accountName,
      accountStatus: 'active',
      ghl: {
        locationId: 'loc_123',
        pitTokenPresent: true,
        status: 'valid',
        checkedAt: '2026-05-23T11:00:00.000Z',
        httpStatus: 200,
        message: null,
      },
      assistable: {
        subaccountId: 'assistable_123',
        status: 'connected',
        checkedAt: '2026-05-23T11:00:00.000Z',
        httpStatus: 200,
        message: null,
      },
      n8n: {
        workflowIds: ['wf_1'],
        workflowCount: 1,
        status: 'healthy',
        checkedAt: '2026-05-23T11:00:00.000Z',
        failingWorkflows: 0,
        staleWorkflows: 0,
      },
    },
  };
}
