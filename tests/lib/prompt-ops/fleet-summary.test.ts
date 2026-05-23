import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import {
  fetchPromptOpsFleetSummary,
  normalizePromptOpsFleetLimit,
  normalizePromptOpsFleetSummaryHours,
} from '../../../src/lib/prompt-ops/fleet-summary.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

describe('fetchPromptOpsFleetSummary', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates recent blocked and high-risk Prompt Ops reviews without fetching raw request context', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            total_reviews: '4',
            low_risk_reviews: '1',
            medium_risk_reviews: '1',
            high_risk_reviews: '2',
            blocked_reviews: '1',
            attention_reviews: '2',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'review-1',
            account_id: 'account-1',
            account_name: 'Complete Lending',
            risk_level: 'high',
            blocked: true,
            summary: 'Pricing compliance needs clarification before deployment.',
            recommended_change_count: '2',
            test_plan_count: '3',
            blocker_count: '1',
            model_used: 'ops-claude-sonnet',
            reviewed_at: new Date('2026-05-23T11:30:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 'account-1',
            account_name: 'Complete Lending',
            total_reviews: '3',
            attention_reviews: '2',
            blocked_reviews: '1',
            high_risk_reviews: '2',
            latest_risk_level: 'high',
            latest_blocked: true,
            latest_reviewed_at: new Date('2026-05-23T11:30:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            risk_level: 'high',
            total_reviews: '2',
            blocked_reviews: '1',
          },
        ],
      } as never);

    const output = await fetchPromptOpsFleetSummary({ sinceHours: 48, limit: 5 });

    expect(output.since).toBe('2026-05-21T12:00:00.000Z');
    expect(output.totalReviews).toBe(4);
    expect(output.attentionReviews).toBe(2);
    expect(output.attentionRate).toBe(50);
    expect(output.recentAttention[0]).toMatchObject({
      accountName: 'Complete Lending',
      riskLevel: 'high',
      blocked: true,
      blockerCount: 1,
      reviewedAt: '2026-05-23T11:30:00.000Z',
    });
    expect(output.topAccounts[0]?.latestBlocked).toBe(true);
    expect(output.riskBreakdown[0]).toEqual({
      riskLevel: 'high',
      totalReviews: 2,
      blockedReviews: 1,
    });
    expect(vi.mocked(query).mock.calls[1]?.[0]).toContain(
      'jsonb_array_length(por.recommended_changes)',
    );
    expect(vi.mocked(query).mock.calls[1]?.[0]).not.toContain('request');
    expect(vi.mocked(query).mock.calls[1]?.[0]).not.toContain('current_prompt');
    expect(vi.mocked(query).mock.calls[1]?.[1]).toEqual(['2026-05-21T12:00:00.000Z', 5]);
  });
});

describe('Prompt Ops fleet normalizers', () => {
  it('clamps hours and limits to supported ranges', () => {
    expect(normalizePromptOpsFleetSummaryHours(undefined)).toBe(168);
    expect(normalizePromptOpsFleetSummaryHours(0)).toBe(168);
    expect(normalizePromptOpsFleetSummaryHours(999)).toBe(720);
    expect(normalizePromptOpsFleetLimit(undefined)).toBe(10);
    expect(normalizePromptOpsFleetLimit(0)).toBe(10);
    expect(normalizePromptOpsFleetLimit(999)).toBe(25);
  });
});
