import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import {
  fetchFleetQaSummary,
  normalizeFleetQaFailureLimit,
  normalizeFleetQaSummaryHours,
} from '../../../src/lib/qa/fleet-summary.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

describe('fetchFleetQaSummary', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates recent fleet QA failures without fetching findings or transcripts', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            total_reviews: '3',
            passed_reviews: '1',
            failed_reviews: '2',
            escalated_reviews: '1',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'review-1',
            account_id: 'account-1',
            account_name: 'Complete Lending',
            call_id: 'call_123',
            review_trigger: 'negative',
            score: '62',
            call_type: 'inbound',
            summary: 'Caller had unresolved objections.',
            finding_count: '2',
            model_used: 'ops-claude-sonnet',
            escalated: true,
            reviewed_at: new Date('2026-05-23T11:30:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 'account-1',
            account_name: 'Complete Lending',
            total_reviews: '2',
            failed_reviews: '2',
            average_score: '61',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            review_trigger: 'negative',
            total_reviews: '2',
            failed_reviews: '2',
          },
        ],
      } as never);

    const output = await fetchFleetQaSummary({ sinceHours: 6, limit: 5 });

    expect(output.since).toBe('2026-05-23T06:00:00.000Z');
    expect(output.totalReviews).toBe(3);
    expect(output.failedReviews).toBe(2);
    expect(output.passRate).toBe(33.3);
    expect(output.failures[0]).toMatchObject({
      accountName: 'Complete Lending',
      findingCount: 2,
      reviewedAt: '2026-05-23T11:30:00.000Z',
    });
    expect(output.topAccounts[0]?.averageScore).toBe(61);
    expect(output.topTriggers[0]?.reviewTrigger).toBe('negative');
    expect(vi.mocked(query).mock.calls[1]?.[0]).toContain('jsonb_array_length(qr.findings)');
    expect(vi.mocked(query).mock.calls[1]?.[0]).not.toContain('transcript');
    expect(vi.mocked(query).mock.calls[1]?.[1]).toEqual(['2026-05-23T06:00:00.000Z', 5]);
  });
});

describe('fleet QA normalizers', () => {
  it('clamps hours and failure limits to supported ranges', () => {
    expect(normalizeFleetQaSummaryHours(undefined)).toBe(24);
    expect(normalizeFleetQaSummaryHours(0)).toBe(24);
    expect(normalizeFleetQaSummaryHours(999)).toBe(168);
    expect(normalizeFleetQaFailureLimit(undefined)).toBe(10);
    expect(normalizeFleetQaFailureLimit(0)).toBe(10);
    expect(normalizeFleetQaFailureLimit(999)).toBe(25);
  });
});
