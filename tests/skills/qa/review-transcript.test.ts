import { describe, expect, it } from 'vitest';
import {
  parseQaReviewCommandArgs,
  parseQaReviewModelOutput,
} from '../../../src/skills/qa/review-transcript.js';
import { ValidationError } from '../../../src/lib/errors.js';

describe('parseQaReviewCommandArgs', () => {
  it('splits account and transcript on :: delimiter', () => {
    expect(
      parseQaReviewCommandArgs('Ron Jones - AFLAC :: Agent: Hi\nCustomer: Hello there'),
    ).toEqual({
      accountQuery: 'Ron Jones - AFLAC',
      transcript: 'Agent: Hi\nCustomer: Hello there',
    });
  });

  it('requires :: delimiter', () => {
    expect(() => parseQaReviewCommandArgs('Ron Jones only')).toThrow(ValidationError);
  });
});

describe('parseQaReviewModelOutput', () => {
  it('parses fenced JSON from the model', () => {
    const result = parseQaReviewModelOutput(
      '```json\n{"score":88,"pass":true,"callType":"inbound","summary":"Solid call","findings":[]}\n```',
    );

    expect(result.score).toBe(88);
    expect(result.pass).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('parses raw JSON objects', () => {
    const result = parseQaReviewModelOutput(
      '{"score":60,"pass":false,"callType":"outbound","summary":"Needs work","findings":[{"severity":"major","category":"Flow","detail":"No close"}]}',
    );

    expect(result.pass).toBe(false);
    expect(result.findings[0]?.category).toBe('Flow');
  });
});
