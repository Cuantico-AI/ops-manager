import { describe, expect, it, vi } from 'vitest';
import {
  clientCheckinListFleetRisksSkill,
  formatClientCheckinFleetSummaryOutput,
  parseClientCheckinFleetSummaryCommandArgs,
} from '../../../src/skills/client-checkin/list-fleet-risks.js';
import {
  fetchClientCheckinFleetSummary,
  type ClientCheckinFleetSummary,
} from '../../../src/lib/client-checkin/fleet-summary.js';

vi.mock('../../../src/lib/client-checkin/fleet-summary.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/lib/client-checkin/fleet-summary.js')>();
  return {
    ...actual,
    fetchClientCheckinFleetSummary: vi.fn(),
  };
});

const fleetSummary: ClientCheckinFleetSummary = {
  sinceHours: 168,
  since: '2026-05-16T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalBriefs: 4,
  healthyBriefs: 1,
  watchBriefs: 2,
  atRiskBriefs: 1,
  attentionBriefs: 3,
  attentionRate: 75,
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalBriefs: 3,
      attentionBriefs: 2,
      latestStatus: 'at_risk',
      latestGeneratedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
  topIssueSystems: [{ system: 'assistable', issueCount: 2 }],
  recentAttention: [
    {
      id: 'brief-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
      status: 'at_risk',
      summary: 'Assistable reconnect is needed before the next campaign.',
      openIssueCount: 2,
      followUpQuestionCount: 1,
      modelUsed: 'ops-claude-sonnet',
      generatedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
};

describe('parseClientCheckinFleetSummaryCommandArgs', () => {
  it('defaults to the standard window with no args', () => {
    expect(parseClientCheckinFleetSummaryCommandArgs('')).toEqual({
      sinceHours: undefined,
      limit: undefined,
    });
  });

  it('parses a trailing hour window and limit flag', () => {
    expect(parseClientCheckinFleetSummaryCommandArgs('240 --limit=5')).toEqual({
      sinceHours: 240,
      limit: 5,
    });
  });

  it('rejects unknown tokens', () => {
    expect(() => parseClientCheckinFleetSummaryCommandArgs('Complete Lending')).toThrow(
      /checkin-fleet-summary/,
    );
  });
});

describe('formatClientCheckinFleetSummaryOutput', () => {
  it('formats fleet attention without exposing stored health signal payloads', () => {
    const text = formatClientCheckinFleetSummaryOutput(fleetSummary);

    expect(text).toContain('Client check-in fleet attention summary.');
    expect(text).toContain('Briefs: 4');
    expect(text).toContain('Attention rate: 75.0%');
    expect(text).toContain('Complete Lending: 2 attention brief(s) / 3 total');
    expect(text).toContain('assistable: 2 issue(s)');
    expect(text).toContain('brief-1');
    expect(text).not.toContain('signals');
    expect(text).not.toContain('pit_');
    expect(text).not.toContain('secret:');
  });

  it('formats an empty brief window', () => {
    const text = formatClientCheckinFleetSummaryOutput({
      ...fleetSummary,
      totalBriefs: 0,
      healthyBriefs: 0,
      watchBriefs: 0,
      atRiskBriefs: 0,
      attentionBriefs: 0,
      attentionRate: 0,
      recentAttention: [],
      topAccounts: [],
      topIssueSystems: [],
    });

    expect(text).toContain('No client check-in briefs found in this window.');
  });
});

describe('clientCheckinListFleetRisksSkill', () => {
  it('audits before and after fetching fleet check-in risks', async () => {
    vi.mocked(fetchClientCheckinFleetSummary).mockResolvedValueOnce(fleetSummary);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    const output = await clientCheckinListFleetRisksSkill.execute(
      { sinceHours: 168 },
      {
        jobId: 'job-1',
        agentId: 'client-checkin',
        audit,
        approval: {} as never,
        llm: {} as never,
      },
    );

    expect(output.attentionBriefs).toBe(3);
    expect(fetchClientCheckinFleetSummary).toHaveBeenCalledWith({ sinceHours: 168 });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls[1]?.[0]).toMatchObject({
      action: 'client-checkin.list-fleet-risks',
      output: {
        totalBriefs: 4,
        attentionBriefs: 3,
        recentAttentionCount: 1,
      },
    });
  });
});
