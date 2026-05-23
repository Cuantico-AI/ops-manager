import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAccountInput } from '../../../src/lib/accounts/resolve-account-input.js';
import { query } from '../../../src/lib/db/client.js';
import { fetchOpsAccountDigest } from '../../../src/lib/ops/account-digest.js';

vi.mock('../../../src/lib/accounts/resolve-account-input.js', () => ({
  resolveAccountInput: vi.fn(),
}));

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

describe('fetchOpsAccountDigest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
    vi.mocked(resolveAccountInput).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Complete Lending',
      status: 'active',
      ghlLocationId: 'loc_123',
      ghlPitTokenRef: null,
    });
    vi.mocked(query).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates one account across persisted Phase 5 attention signals', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            total_reviews: '3',
            passed_reviews: '1',
            failed_reviews: '2',
            escalated_reviews: '1',
            average_score: '70',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'qa-1',
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
        rows: [{ review_trigger: 'negative', total_reviews: '2', failed_reviews: '2' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            total_briefs: '2',
            healthy_briefs: '0',
            watch_briefs: '1',
            at_risk_briefs: '1',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'brief-1',
            status: 'at_risk',
            summary: 'OAuth and workflow checks need attention.',
            open_issue_count: '2',
            follow_up_question_count: '1',
            model_used: 'ops-claude-sonnet',
            generated_at: new Date('2026-05-23T11:45:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ system: 'assistable', issue_count: '2' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            total_reviews: '2',
            low_risk_reviews: '0',
            medium_risk_reviews: '1',
            high_risk_reviews: '1',
            blocked_reviews: '1',
            attention_reviews: '1',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'prompt-1',
            risk_level: 'high',
            blocked: true,
            summary: 'Needs more samples before prompt rollout.',
            recommended_change_count: '1',
            test_plan_count: '2',
            blocker_count: '1',
            model_used: 'ops-claude-sonnet',
            reviewed_at: new Date('2026-05-23T11:15:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ risk_level: 'high', total_reviews: '1', blocked_reviews: '1' }],
      } as never);

    const digest = await fetchOpsAccountDigest({
      accountQuery: 'Complete Lending',
      sinceHours: 12,
      limit: 5,
    });

    expect(resolveAccountInput).toHaveBeenCalledWith({
      accountQuery: 'Complete Lending',
      sinceHours: 12,
      limit: 5,
    });
    expect(digest).toMatchObject({
      accountName: 'Complete Lending',
      sinceHours: 12,
      since: '2026-05-23T00:00:00.000Z',
      generatedAt: '2026-05-23T12:00:00.000Z',
      totalAttentionSignals: 5,
      signalCategories: 3,
      latestSignalAt: '2026-05-23T11:45:00.000Z',
    });
    expect(digest.qa.passRate).toBe(33.3);
    expect(digest.clientCheckin.attentionRate).toBe(100);
    expect(digest.promptOps.attentionRate).toBe(50);
    expect(digest.qa.failures[0]?.findingCount).toBe(2);
    expect(digest.clientCheckin.topIssueSystems[0]?.system).toBe('assistable');
    expect(digest.promptOps.riskBreakdown[0]?.riskLevel).toBe('high');
    expect(vi.mocked(query).mock.calls[1]?.[0]).toContain('jsonb_array_length(qr.findings)');
    expect(vi.mocked(query).mock.calls[1]?.[0]).not.toContain('transcript');
    expect(vi.mocked(query).mock.calls[1]?.[1]).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '2026-05-23T00:00:00.000Z',
      5,
    ]);
  });
});
