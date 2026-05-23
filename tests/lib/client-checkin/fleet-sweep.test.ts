import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import { ValidationError } from '../../../src/lib/errors.js';
import {
  executeClientCheckinFleetSweep,
  formatClientCheckinFleetSweepOutput,
  listClientCheckinFleetSweepCandidates,
  normalizeClientCheckinFleetSweepConcurrency,
  normalizeClientCheckinFleetSweepLimit,
  normalizeClientCheckinFleetSweepMinHours,
  parseClientCheckinFleetSweepCommandArgs,
} from '../../../src/lib/client-checkin/fleet-sweep.js';
import type { GenerateClientCheckinBriefOutput } from '../../../src/skills/client-checkin/generate-brief.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

const accountOneId = '11111111-1111-4111-8111-111111111111';
const accountTwoId = '22222222-2222-4222-8222-222222222222';
const accountThreeId = '33333333-3333-4333-8333-333333333333';

describe('listClientCheckinFleetSweepCandidates', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('lists active accounts with their latest brief timestamp', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          id: accountOneId,
          name: 'Complete Lending',
          status: 'active',
          latest_brief_generated_at: new Date('2026-05-22T12:00:00.000Z'),
        },
      ],
    } as never);

    const candidates = await listClientCheckinFleetSweepCandidates({ limit: 25 });

    expect(candidates).toEqual([
      {
        accountId: accountOneId,
        accountName: 'Complete Lending',
        accountStatus: 'active',
        latestBriefGeneratedAt: '2026-05-22T12:00:00.000Z',
      },
    ]);
    expect(vi.mocked(query).mock.calls[0]?.[0]).toContain("a.status = 'active'");
    expect(vi.mocked(query).mock.calls[0]?.[1]).toEqual([false, 25]);
  });
});

describe('executeClientCheckinFleetSweep', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips recent briefs, persists stale generated briefs, and keeps per-account failures', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          id: accountOneId,
          name: 'Complete Lending',
          status: 'active',
          latest_brief_generated_at: '2026-05-21T12:00:00.000Z',
        },
        {
          id: accountTwoId,
          name: 'Fresh Account',
          status: 'active',
          latest_brief_generated_at: '2026-05-23T01:00:00.000Z',
        },
        {
          id: accountThreeId,
          name: 'Broken Account',
          status: 'active',
          latest_brief_generated_at: null,
        },
      ],
    } as never);

    const generateBrief = vi
      .fn()
      .mockResolvedValueOnce(makeBrief(accountOneId, 'Complete Lending', 'watch'))
      .mockRejectedValueOnce(new Error('model unavailable'));
    const persistBrief = vi.fn().mockResolvedValueOnce({
      id: 'brief-1',
    });

    const summary = await executeClientCheckinFleetSweep({
      jobId: 'job-1',
      ctx: {
        jobId: 'job-1',
        agentId: 'client-checkin',
        audit: {} as never,
        approval: {} as never,
        llm: {} as never,
      },
      minHours: 24,
      concurrency: 2,
      generateBrief,
      persistBrief,
    });

    expect(generateBrief).toHaveBeenCalledTimes(2);
    expect(generateBrief).toHaveBeenCalledWith(
      { accountId: accountOneId, includeInactive: true, model: undefined },
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
      'skipped_recent',
      'failed',
    ]);
  });
});

describe('client check-in fleet sweep parser and formatter', () => {
  it('parses sweep controls', () => {
    expect(
      parseClientCheckinFleetSweepCommandArgs('48 --limit=25 --concurrency 2 --include-inactive'),
    ).toEqual({
      minHours: 48,
      limit: 25,
      concurrency: 2,
      includeInactive: true,
    });
  });

  it('rejects unknown tokens', () => {
    expect(() => parseClientCheckinFleetSweepCommandArgs('Complete Lending')).toThrow(
      ValidationError,
    );
  });

  it('formats generated counts without exposing signal payloads or secrets', () => {
    const text = formatClientCheckinFleetSweepOutput({
      minHours: 24,
      includeInactive: false,
      concurrency: 3,
      startedAt: '2026-05-23T12:00:00.000Z',
      completedAt: '2026-05-23T12:01:00.000Z',
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
          briefId: 'brief-1',
          status: 'watch',
          generatedAt: '2026-05-23T12:00:00.000Z',
          openIssueCount: 1,
          followUpQuestionCount: 1,
        },
      ],
    });

    expect(text).toContain('Client check-in fleet sweep complete.');
    expect(text).toContain('Complete Lending');
    expect(text).toContain('brief-1');
    expect(text).not.toContain('signals');
    expect(text).not.toContain('pit_');
    expect(text).not.toContain('secret:');
  });
});

describe('client check-in fleet sweep normalizers', () => {
  it('clamps controls to supported ranges', () => {
    expect(normalizeClientCheckinFleetSweepMinHours(undefined)).toBe(24);
    expect(normalizeClientCheckinFleetSweepMinHours(999)).toBe(720);
    expect(normalizeClientCheckinFleetSweepConcurrency(undefined)).toBe(3);
    expect(normalizeClientCheckinFleetSweepConcurrency(999)).toBe(10);
    expect(normalizeClientCheckinFleetSweepLimit(undefined)).toBeUndefined();
    expect(normalizeClientCheckinFleetSweepLimit(9999)).toBe(500);
  });
});

function makeBrief(
  accountId: string,
  accountName: string,
  status: GenerateClientCheckinBriefOutput['status'],
): GenerateClientCheckinBriefOutput {
  return {
    accountId,
    accountName,
    generatedAt: '2026-05-23T12:00:00.000Z',
    modelUsed: 'ops-claude-sonnet',
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
