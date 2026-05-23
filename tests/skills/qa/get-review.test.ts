import { describe, expect, it } from 'vitest';
import {
  formatQaReviewRecordOutput,
  parseQaShowCommandArgs,
} from '../../../src/skills/qa/get-review.js';

describe('parseQaShowCommandArgs', () => {
  it('parses a call ID', () => {
    expect(parseQaShowCommandArgs(' call_123 ')).toEqual({ callId: 'call_123' });
  });
});

describe('formatQaReviewRecordOutput', () => {
  it('formats a persisted review with findings', () => {
    const text = formatQaReviewRecordOutput({
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
    });

    expect(text).toContain('QA review found.');
    expect(text).toContain('Call ID: call_123');
    expect(text).toContain('62/100 (FAIL)');
    expect(text).toContain('[MAJOR] Objection');
  });
});
