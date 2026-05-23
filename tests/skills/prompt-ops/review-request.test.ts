import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/lib/errors.js';
import {
  formatPromptOpsReviewOutput,
  parsePromptOpsCommandArgs,
  parsePromptOpsModelOutput,
  type ReviewPromptOpsRequestOutput,
} from '../../../src/skills/prompt-ops/review-request.js';

describe('parsePromptOpsCommandArgs', () => {
  it('splits account and prompt-change request on the delimiter', () => {
    expect(
      parsePromptOpsCommandArgs(
        '  Complete Lending :: tighten objection handling for price questions  ',
      ),
    ).toEqual({
      accountQuery: 'Complete Lending',
      request: 'tighten objection handling for price questions',
    });
  });

  it('requires the delimiter', () => {
    expect(() => parsePromptOpsCommandArgs('Complete Lending tighten objection handling')).toThrow(
      ValidationError,
    );
  });

  it('requires enough request detail after the delimiter', () => {
    expect(() => parsePromptOpsCommandArgs('Complete Lending :: short')).toThrow(ValidationError);
  });
});

describe('parsePromptOpsModelOutput', () => {
  it('parses fenced JSON from the model', () => {
    const review = parsePromptOpsModelOutput(
      [
        '```json',
        '{',
        '  "riskLevel": "medium",',
        '  "blocked": false,',
        '  "summary": "Request is scoped but needs regression tests.",',
        '  "intendedOutcome": "Improve pricing objection handling.",',
        '  "recommendedChanges": ["Add one concise empathy instruction."],',
        '  "testPlan": ["Simulate a pricing objection."],',
        '  "rollbackPlan": ["Keep the prior prompt version available."],',
        '  "clarifyingQuestions": ["Which pricing claims are approved?"],',
        '  "blockers": []',
        '}',
        '```',
      ].join('\n'),
    );

    expect(review.riskLevel).toBe('medium');
    expect(review.testPlan).toEqual(['Simulate a pricing objection.']);
  });

  it('parses raw JSON objects', () => {
    const review = parsePromptOpsModelOutput(
      '{"riskLevel":"low","blocked":false,"summary":"Tone-only change.","intendedOutcome":"Sound warmer.","recommendedChanges":["Make greeting warmer."],"testPlan":[],"rollbackPlan":["Restore prior wording."],"clarifyingQuestions":[],"blockers":[]}',
    );

    expect(review.riskLevel).toBe('low');
    expect(review.blocked).toBe(false);
  });
});

describe('formatPromptOpsReviewOutput', () => {
  it('formats risk, recommended changes, tests, and blockers for Slack', () => {
    const output: ReviewPromptOpsRequestOutput = {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      reviewedAt: '2026-05-23T02:00:00.000Z',
      modelUsed: 'ops-claude-sonnet',
      requestChars: 84,
      currentPromptChars: 0,
      conversationSampleChars: 120,
      riskLevel: 'high',
      blocked: true,
      summary: 'The request touches compliance-sensitive claims.',
      intendedOutcome: 'Improve conversion without overpromising loan outcomes.',
      recommendedChanges: ['Keep claims generic until approved language is supplied.'],
      testPlan: ['Test a caller asking for guaranteed approval.'],
      rollbackPlan: ['Restore the prior assistant prompt and monitor QA failures.'],
      clarifyingQuestions: ['What lending claims are approved by compliance?'],
      blockers: ['Approved compliance language is missing.'],
    };

    const formatted = formatPromptOpsReviewOutput(output);

    expect(formatted).toContain('Risk: HIGH');
    expect(formatted).toContain('Blocked: yes');
    expect(formatted).toContain('• Test a caller asking for guaranteed approval.');
    expect(formatted).toContain('Blockers:');
  });
});
