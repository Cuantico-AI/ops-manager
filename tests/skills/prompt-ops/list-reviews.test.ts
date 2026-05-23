import { describe, expect, it } from 'vitest';
import {
  formatPromptOpsReviewHistoryOutput,
  parsePromptOpsHistoryCommandArgs,
} from '../../../src/skills/prompt-ops/list-reviews.js';

describe('parsePromptOpsHistoryCommandArgs', () => {
  it('uses a trailing number as the limit', () => {
    expect(parsePromptOpsHistoryCommandArgs('Complete Lending 5')).toEqual({
      accountQuery: 'Complete Lending',
      limit: 5,
      blockedOnly: false,
    });
  });

  it('supports blocked-only flags', () => {
    expect(parsePromptOpsHistoryCommandArgs('Complete Lending --blocked')).toEqual({
      accountQuery: 'Complete Lending',
      limit: undefined,
      blockedOnly: true,
    });
  });
});

describe('formatPromptOpsReviewHistoryOutput', () => {
  it('formats recent review summaries without raw prompt context', () => {
    const text = formatPromptOpsReviewHistoryOutput({
      accountId: '00000000-0000-0000-0000-000000000001',
      accountName: 'Complete Lending',
      limit: 10,
      blockedOnly: true,
      reviews: [
        {
          id: '00000000-0000-0000-0000-000000000300',
          jobId: '00000000-0000-0000-0000-000000000010',
          accountId: '00000000-0000-0000-0000-000000000001',
          accountName: 'Complete Lending',
          reviewedAt: '2026-05-23T02:00:00.000Z',
          createdAt: '2026-05-23T02:00:01.000Z',
          modelUsed: 'ops-claude-sonnet',
          requestChars: 84,
          currentPromptChars: 0,
          conversationSampleChars: 120,
          riskLevel: 'high',
          blocked: true,
          summary: 'Compliance-sensitive request needs approved language.',
          intendedOutcome: 'Improve pricing objection handling without overpromising.',
          recommendedChanges: ['Keep claims generic until approved.'],
          testPlan: ['Test a caller asking for guaranteed approval.'],
          rollbackPlan: ['Restore the prior prompt.'],
          clarifyingQuestions: ['Which lending claims are approved?'],
          blockers: ['Approved compliance language is missing.'],
        },
      ],
    });

    expect(text).toContain('Recent blocked Prompt Ops reviews:');
    expect(text).toContain('HIGH BLOCKED');
    expect(text).toContain('00000000-0000-0000-0000-000000000300');
    expect(text).not.toContain('Agent prompt raw text');
  });
});
