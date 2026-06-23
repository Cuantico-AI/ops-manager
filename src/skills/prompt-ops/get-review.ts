import { z } from 'zod';
import {
  getPromptOpsReviewById,
  type PromptOpsReviewRecord,
} from '../../lib/prompt-ops/reviews.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const getPromptOpsReviewInputSchema = z.object({
  reviewId: z.string().uuid(),
});

export type GetPromptOpsReviewInput = z.infer<typeof getPromptOpsReviewInputSchema>;

export const promptOpsGetReviewSkill: Skill<GetPromptOpsReviewInput, PromptOpsReviewRecord> = {
  id: 'prompt-ops.get-review',
  description: 'Retrieve a persisted Prompt Ops review by ID',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: getPromptOpsReviewInputSchema,
  async execute(input, ctx: SkillContext): Promise<PromptOpsReviewRecord> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.get-review',
      target: input.reviewId,
      mutated: false,
      input: {
        reviewId: input.reviewId,
      },
    });

    const output = await getPromptOpsReviewById(input.reviewId);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.get-review',
      target: output.accountId,
      mutated: false,
      output: {
        reviewId: output.id,
        accountId: output.accountId,
        accountName: output.accountName,
        riskLevel: output.riskLevel,
        blocked: output.blocked,
      },
    });

    return output;
  },
};

export function parsePromptOpsShowCommandArgs(args: string): GetPromptOpsReviewInput {
  const reviewId = args.trim();
  if (!reviewId) {
    throw new ValidationError('Usage: /ops prompt-show <review_id>');
  }
  return { reviewId };
}

export function formatPromptOpsReviewRecordOutput(review: PromptOpsReviewRecord): string {
  const lines = [
    'Prompt Ops review found.',
    `Review ID: ${review.id}`,
    `Account: ${review.accountName}`,
    `Risk: ${review.riskLevel.toUpperCase()}`,
    `Blocked: ${review.blocked ? 'yes' : 'no'}`,
    `Model: ${review.modelUsed}`,
    `Reviewed at: ${review.reviewedAt}`,
    `Context: request ${review.requestChars} chars, current prompt ${review.currentPromptChars} chars, sample ${review.conversationSampleChars} chars`,
    '',
    `Summary: ${review.summary}`,
    `Intended outcome: ${review.intendedOutcome}`,
    '',
    'Recommended changes:',
    ...formatList(review.recommendedChanges),
    '',
    'Test plan:',
    ...formatList(review.testPlan),
    '',
    'Rollback / monitoring:',
    ...formatList(review.rollbackPlan),
  ];

  if (review.clarifyingQuestions.length > 0) {
    lines.push('', 'Clarifying questions:', ...formatList(review.clarifyingQuestions));
  }

  if (review.blockers.length > 0) {
    lines.push('', 'Blockers:', ...formatList(review.blockers));
  }

  return lines.join('\n');
}

function formatList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ['- none'];
}
