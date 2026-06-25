import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import {
  getQaReviewByCallId,
  listQaReviewsForAccount,
  persistQaReview,
} from '../../../src/lib/qa/reviews.js';
import { NotFoundError } from '../../../src/lib/errors.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));
vi.mock('../../../src/lib/db/prisma.js', () => ({
  prisma: {
    accounts: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const accountId = '00000000-0000-0000-0000-000000000001';
const jobId = '00000000-0000-0000-0000-000000000010';
const findings = [
  { severity: 'major' as const, category: 'Objection', detail: 'No clear next step.' },
];

const reviewRow = {
  id: '00000000-0000-0000-0000-000000000100',
  job_id: jobId,
  account_id: accountId,
  account_name: 'Complete Lending',
  call_id: 'call_123',
  review_trigger: 'negative',
  score: 62,
  pass: false,
  call_type: 'inbound',
  summary: 'Caller had unresolved objections.',
  findings,
  model_used: 'ops-claude-sonnet',
  escalated: true,
  transcript_chars: 2400,
  reviewed_at: new Date('2026-05-23T01:00:00.000Z'),
};

describe('persistQaReview', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('upserts webhook reviews by call ID without storing transcript text', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [reviewRow] } as never);

    const review = await persistQaReview({
      jobId,
      escalated: true,
      output: {
        accountId,
        accountName: 'Complete Lending',
        callId: 'call_123',
        reviewTrigger: 'negative',
        callType: 'inbound',
        score: 62,
        pass: false,
        summary: 'Caller had unresolved objections.',
        findings,
        transcriptChars: 2400,
        reviewedAt: '2026-05-23T01:00:00.000Z',
        modelUsed: 'ops-claude-sonnet',
      },
    });

    expect(review.id).toBe(reviewRow.id);
    expect(review.findings).toHaveLength(1);
    expect(vi.mocked(query).mock.calls[0]?.[0]).toContain('ON CONFLICT (call_id)');
    expect(JSON.stringify(vi.mocked(query).mock.calls[0]?.[1])).not.toContain('Agent:');
  });
});

describe('listQaReviewsForAccount', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('resolves an account and filters to failed reviews when requested', async () => {
    const { prisma } = await import('../../../src/lib/db/prisma.js');
    vi.mocked(prisma.accounts.findMany).mockResolvedValueOnce([
      {
        id: accountId,
        name: 'Complete Lending',
        status: 'active',
        ghl_location_id: 'loc_123',
        ghl_pit_token_ref: null,
      },
    ] as never);
    vi.mocked(query).mockResolvedValueOnce({ rows: [reviewRow] } as never);

    const output = await listQaReviewsForAccount({
      accountQuery: 'Complete',
      limit: 2,
      failingOnly: true,
    });

    expect(output.accountName).toBe('Complete Lending');
    expect(output.reviews[0]?.pass).toBe(false);
    expect(vi.mocked(query).mock.calls[0]?.[0]).toContain('qr.pass = FALSE');
  });
});

describe('getQaReviewByCallId', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('throws NotFoundError when no review matches the call ID', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await expect(getQaReviewByCallId('call_missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
