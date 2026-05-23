import { describe, expect, it, vi } from 'vitest';
import {
  formatQaFleetSummaryOutput,
  parseQaFleetSummaryCommandArgs,
  qaListFleetFailuresSkill,
} from '../../../src/skills/qa/list-fleet-failures.js';
import { fetchFleetQaSummary, type FleetQaSummary } from '../../../src/lib/qa/fleet-summary.js';

vi.mock('../../../src/lib/qa/fleet-summary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/qa/fleet-summary.js')>();
  return {
    ...actual,
    fetchFleetQaSummary: vi.fn(),
  };
});

const fleetSummary: FleetQaSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalReviews: 3,
  passedReviews: 1,
  failedReviews: 2,
  escalatedReviews: 1,
  passRate: 33.3,
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
  failures: [
    {
      id: 'review-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
      callId: 'call_123',
      reviewTrigger: 'negative',
      score: 62,
      callType: 'inbound',
      summary: 'Caller had unresolved objections. Agent: this should not be transcript text.',
      findingCount: 2,
      modelUsed: 'ops-claude-sonnet',
      escalated: true,
      reviewedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
};

describe('parseQaFleetSummaryCommandArgs', () => {
  it('defaults to the standard window with no args', () => {
    expect(parseQaFleetSummaryCommandArgs('')).toEqual({
      sinceHours: undefined,
      limit: undefined,
    });
  });

  it('parses a trailing hour window and limit flag', () => {
    expect(parseQaFleetSummaryCommandArgs('48 --limit=5')).toEqual({
      sinceHours: 48,
      limit: 5,
    });
  });

  it('rejects unknown tokens', () => {
    expect(() => parseQaFleetSummaryCommandArgs('Complete Lending')).toThrow(
      /qa-fleet-summary/,
    );
  });
});

describe('formatQaFleetSummaryOutput', () => {
  it('formats fleet failures without findings details or call transcripts', () => {
    const text = formatQaFleetSummaryOutput(fleetSummary);

    expect(text).toContain('Fleet QA failure summary.');
    expect(text).toContain('Reviewed: 3');
    expect(text).toContain('Pass rate: 33.3%');
    expect(text).toContain('Complete Lending: 2 failure(s) / 2 review(s)');
    expect(text).toContain('call call_123');
    expect(text).toContain('findings: 2');
    expect(text).not.toContain('[MAJOR]');
    expect(text).not.toContain('Quote:');
  });

  it('formats an empty review window', () => {
    const text = formatQaFleetSummaryOutput({
      ...fleetSummary,
      totalReviews: 0,
      passedReviews: 0,
      failedReviews: 0,
      escalatedReviews: 0,
      passRate: 0,
      failures: [],
      topAccounts: [],
      topTriggers: [],
    });

    expect(text).toContain('No QA reviews found in this window.');
  });
});

describe('qaListFleetFailuresSkill', () => {
  it('audits before and after fetching fleet QA failures', async () => {
    vi.mocked(fetchFleetQaSummary).mockResolvedValueOnce(fleetSummary);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    const output = await qaListFleetFailuresSkill.execute(
      { sinceHours: 24 },
      {
        jobId: 'job-1',
        agentId: 'qa-review',
        audit,
        approval: {} as never,
        llm: {} as never,
      },
    );

    expect(output.failedReviews).toBe(2);
    expect(fetchFleetQaSummary).toHaveBeenCalledWith({ sinceHours: 24 });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[1]?.[0]).toMatchObject({
      action: 'qa.list-fleet-failures',
      output: {
        totalReviews: 3,
        failedReviews: 2,
        failureCount: 1,
      },
    });
  });
});
