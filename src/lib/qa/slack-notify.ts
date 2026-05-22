import type { QaAutoReviewDecision } from './review-policy.js';
import type { ReviewTranscriptOutput } from '../../skills/qa/review-transcript.js';
import { formatQaReviewOutput } from '../../skills/qa/review-transcript.js';

export function formatAutoQaReviewSlackMessage(input: {
  output: ReviewTranscriptOutput;
  decision: QaAutoReviewDecision;
  userSentiment?: string;
  escalated: boolean;
}): string {
  const lines = [
    input.decision.flagged ? 'QA review flagged.' : 'QA review sampled.',
    formatQaReviewOutput(input.output),
  ];

  if (input.userSentiment) {
    lines.splice(1, 0, `Assistable sentiment: ${input.userSentiment}`);
  }

  if (input.escalated) {
    lines.push('', 'Escalated to Sonnet after Haiku FAIL.');
  }

  return lines.join('\n');
}
