import { z } from 'zod';
import { getQaReviewByCallId, type QaReviewRecord } from '../../lib/qa/reviews.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const getQaReviewInputSchema = z.object({
  callId: z.string().trim().min(1),
});

export type GetQaReviewInput = z.infer<typeof getQaReviewInputSchema>;

export const qaGetReviewSkill: Skill<GetQaReviewInput, QaReviewRecord> = {
  id: 'qa.get-review',
  description: 'Retrieve a persisted QA review by Assistable call ID',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: getQaReviewInputSchema,
  async execute(input, ctx: SkillContext): Promise<QaReviewRecord> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.get-review',
      target: input.callId,
      mutated: false,
      input: {
        callId: input.callId,
      },
    });

    const output = await getQaReviewByCallId(input.callId);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.get-review',
      target: output.accountId,
      mutated: false,
      output: {
        callId: output.callId,
        accountId: output.accountId,
        accountName: output.accountName,
        score: output.score,
        pass: output.pass,
        findingCount: output.findings.length,
      },
    });

    return output;
  },
};

export function parseQaShowCommandArgs(args: string): GetQaReviewInput {
  const callId = args.trim();
  if (!callId) {
    throw new ValidationError('Usage: /ops qa-show <call_id>');
  }
  return { callId };
}

export function formatQaReviewRecordOutput(review: QaReviewRecord): string {
  const lines = [
    'QA review found.',
    `Account: ${review.accountName}`,
    `Call ID: ${review.callId ?? 'n/a'}`,
    `Score: ${review.score}/100 (${review.pass ? 'PASS' : 'FAIL'})`,
    `Call type: ${review.callType}`,
    `Trigger: ${review.reviewTrigger}`,
    `Model: ${review.modelUsed}${review.escalated ? ' (escalated)' : ''}`,
    `Transcript length: ${review.transcriptChars} chars`,
    `Reviewed at: ${review.reviewedAt}`,
    '',
    `Summary: ${review.summary}`,
  ];

  if (review.findings.length === 0) {
    lines.push('', 'Findings: none');
    return lines.join('\n');
  }

  lines.push('', 'Findings:');
  for (const [index, finding] of review.findings.entries()) {
    lines.push(
      `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.category}: ${finding.detail}`,
    );
    if (finding.quote) {
      lines.push(`   Quote: "${finding.quote}"`);
    }
  }

  return lines.join('\n');
}
