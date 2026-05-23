import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import {
  getPromptOpsReviewById,
  listPromptOpsReviewsForAccount,
  persistPromptOpsReview,
} from '../../../src/lib/prompt-ops/reviews.js';
import { NotFoundError } from '../../../src/lib/errors.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

const accountId = '00000000-0000-0000-0000-000000000001';
const jobId = '00000000-0000-0000-0000-000000000010';
const reviewId = '00000000-0000-0000-0000-000000000300';

const reviewRow = {
  id: reviewId,
  job_id: jobId,
  account_id: accountId,
  account_name: 'Complete Lending',
  risk_level: 'high' as const,
  blocked: true,
  summary: 'Compliance-sensitive request needs approved language.',
  intended_outcome: 'Improve pricing objection handling without overpromising.',
  recommended_changes: ['Keep lending claims generic until compliance approves wording.'],
  test_plan: ['Test a caller asking for guaranteed approval.'],
  rollback_plan: ['Restore the prior prompt and monitor QA failures.'],
  clarifying_questions: ['Which lending claims are approved?'],
  blockers: ['Approved compliance language is missing.'],
  model_used: 'ops-claude-sonnet',
  request_chars: 84,
  current_prompt_chars: 0,
  conversation_sample_chars: 120,
  reviewed_at: new Date('2026-05-23T02:00:00.000Z'),
  created_at: new Date('2026-05-23T02:00:01.000Z'),
};

describe('persistPromptOpsReview', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('stores structured review output without raw prompt context', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [reviewRow] } as never);

    const review = await persistPromptOpsReview({
      jobId,
      output: {
        accountId,
        accountName: 'Complete Lending',
        reviewedAt: '2026-05-23T02:00:00.000Z',
        modelUsed: 'ops-claude-sonnet',
        requestChars: 84,
        currentPromptChars: 0,
        conversationSampleChars: 120,
        riskLevel: 'high',
        blocked: true,
        summary: 'Compliance-sensitive request needs approved language.',
        intendedOutcome: 'Improve pricing objection handling without overpromising.',
        recommendedChanges: ['Keep lending claims generic until compliance approves wording.'],
        testPlan: ['Test a caller asking for guaranteed approval.'],
        rollbackPlan: ['Restore the prior prompt and monitor QA failures.'],
        clarifyingQuestions: ['Which lending claims are approved?'],
        blockers: ['Approved compliance language is missing.'],
      },
    });

    expect(review.id).toBe(reviewId);
    expect(review.blocked).toBe(true);
    expect(review.recommendedChanges).toHaveLength(1);
    expect(JSON.stringify(vi.mocked(query).mock.calls[0]?.[1])).not.toContain(
      'Agent prompt raw text',
    );
  });
});

describe('listPromptOpsReviewsForAccount', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('resolves an account and filters to blocked reviews when requested', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: accountId,
            name: 'Complete Lending',
            status: 'active',
            ghl_location_id: 'loc_123',
            ghl_pit_token_ref: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [reviewRow] } as never);

    const output = await listPromptOpsReviewsForAccount({
      accountQuery: 'Complete',
      limit: 2,
      blockedOnly: true,
    });

    expect(output.accountName).toBe('Complete Lending');
    expect(output.reviews[0]?.blocked).toBe(true);
    expect(vi.mocked(query).mock.calls[1]?.[0]).toContain('por.blocked = TRUE');
  });
});

describe('getPromptOpsReviewById', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('throws NotFoundError when no review matches the ID', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await expect(getPromptOpsReviewById(reviewId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
