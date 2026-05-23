import { describe, expect, it } from 'vitest';
import {
  formatQaReviewHistoryOutput,
  parseQaHistoryCommandArgs,
} from '../../../src/skills/qa/list-reviews.js';

describe('parseQaHistoryCommandArgs', () => {
  it('uses a trailing number as the limit', () => {
    expect(parseQaHistoryCommandArgs('Complete Lending 5')).toEqual({
      accountQuery: 'Complete Lending',
      limit: 5,
      failingOnly: false,
    });
  });

  it('supports failure-only flags', () => {
    expect(parseQaHistoryCommandArgs('Complete Lending --failed')).toEqual({
      accountQuery: 'Complete Lending',
      limit: undefined,
      failingOnly: true,
    });
  });
});

describe('formatQaReviewHistoryOutput', () => {
  it('formats recent review summaries without transcript content', () => {
    const text = formatQaReviewHistoryOutput({
      accountId: '00000000-0000-0000-0000-000000000001',
      accountName: 'Complete Lending',
      limit: 10,
      failingOnly: true,
      reviews: [
        {
          id: '00000000-0000-0000-0000-000000000100',
          jobId: '00000000-0000-0000-0000-000000000010',
          accountId: '00000000-0000-0000-0000-000000000001',
          accountName: 'Complete Lending',
          callId: 'call_123',
          reviewTrigger: 'negative',
          score: 62,
          pass: false,
          callType: 'inbound',
          summary: 'Caller had unresolved objections.',
          findings: [{ severity: 'major', category: 'Objection', detail: 'No clear next step.' }],
          modelUsed: 'ops-claude-sonnet',
          escalated: true,
          transcriptChars: 2400,
          reviewedAt: '2026-05-23T01:00:00.000Z',
        },
      ],
    });

    expect(text).toContain('Recent failing QA reviews:');
    expect(text).toContain('62/100 FAIL');
    expect(text).toContain('call call_123');
    expect(text).not.toContain('Agent:');
  });
});
