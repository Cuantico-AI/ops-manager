import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import {
  fetchClientCheckinFleetSummary,
  normalizeClientCheckinFleetLimit,
  normalizeClientCheckinFleetSummaryHours,
} from '../../../src/lib/client-checkin/fleet-summary.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

describe('fetchClientCheckinFleetSummary', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates recent fleet check-in risks without fetching stored signal payloads', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            total_briefs: '4',
            healthy_briefs: '1',
            watch_briefs: '2',
            at_risk_briefs: '1',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'brief-1',
            account_id: 'account-1',
            account_name: 'Complete Lending',
            status: 'at_risk',
            summary: 'OAuth reconnect required before campaign launch.',
            open_issue_count: '2',
            follow_up_question_count: '1',
            model_used: 'ops-claude-sonnet',
            generated_at: new Date('2026-05-23T11:30:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 'account-1',
            account_name: 'Complete Lending',
            total_briefs: '3',
            attention_briefs: '2',
            latest_status: 'at_risk',
            latest_generated_at: new Date('2026-05-23T11:30:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            system: 'assistable',
            issue_count: '2',
          },
        ],
      } as never);

    const output = await fetchClientCheckinFleetSummary({ sinceHours: 48, limit: 5 });

    expect(output.since).toBe('2026-05-21T12:00:00.000Z');
    expect(output.totalBriefs).toBe(4);
    expect(output.attentionBriefs).toBe(3);
    expect(output.attentionRate).toBe(75);
    expect(output.recentAttention[0]).toMatchObject({
      accountName: 'Complete Lending',
      status: 'at_risk',
      openIssueCount: 2,
      generatedAt: '2026-05-23T11:30:00.000Z',
    });
    expect(output.topAccounts[0]?.latestStatus).toBe('at_risk');
    expect(output.topIssueSystems[0]).toEqual({ system: 'assistable', issueCount: 2 });
    expect(vi.mocked(query).mock.calls[1]?.[0]).toContain('jsonb_array_length(ccb.open_issues)');
    expect(vi.mocked(query).mock.calls[1]?.[0]).not.toContain('ccb.signals');
    expect(vi.mocked(query).mock.calls[1]?.[1]).toEqual(['2026-05-21T12:00:00.000Z', 5]);
  });
});

describe('client check-in fleet normalizers', () => {
  it('clamps hours and limits to supported ranges', () => {
    expect(normalizeClientCheckinFleetSummaryHours(undefined)).toBe(168);
    expect(normalizeClientCheckinFleetSummaryHours(0)).toBe(168);
    expect(normalizeClientCheckinFleetSummaryHours(999)).toBe(720);
    expect(normalizeClientCheckinFleetLimit(undefined)).toBe(10);
    expect(normalizeClientCheckinFleetLimit(0)).toBe(10);
    expect(normalizeClientCheckinFleetLimit(999)).toBe(25);
  });
});
