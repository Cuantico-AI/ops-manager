import { describe, expect, it } from 'vitest';
import {
  formatPromptOpsReviewRecordOutput,
  parsePromptOpsShowCommandArgs,
} from '../../../src/skills/prompt-ops/get-review.js';

describe('parsePromptOpsShowCommandArgs', () => {
  it('parses a review ID', () => {
    expect(parsePromptOpsShowCommandArgs(' 00000000-0000-0000-0000-000000000300 ')).toEqual({
      reviewId: '00000000-0000-0000-0000-000000000300',
    });
  });
});

describe('formatPromptOpsReviewRecordOutput', () => {
  it('formats a persisted review with recommendations and blockers', () => {
    const text = formatPromptOpsReviewRecordOutput({
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
    });

    expect(text).toContain('Prompt Ops review found.');
    expect(text).toContain('Risk: HIGH');
    expect(text).toContain('Blocked: yes');
    expect(text).toContain('Blockers:');
  });
});
