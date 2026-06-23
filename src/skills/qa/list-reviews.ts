import { z } from 'zod';
import {
  listQaReviewsForAccount,
  type ListQaReviewsOutput,
  type QaReviewRecord,
} from '../../lib/qa/reviews.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const listQaReviewsInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  failingOnly: z.boolean().optional(),
});

export type ListQaReviewsSkillInput = z.infer<typeof listQaReviewsInputSchema>;

export const qaListReviewsSkill: Skill<ListQaReviewsSkillInput, ListQaReviewsOutput> = {
  id: 'qa.list-reviews',
  description: 'List recent persisted QA reviews for an account',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: listQaReviewsInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListQaReviewsOutput> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.list-reviews',
      target: input.accountId ?? input.accountQuery ?? 'unknown',
      mutated: false,
      input: {
        accountId: input.accountId,
        accountQuery: input.accountQuery,
        limit: input.limit,
        failingOnly: input.failingOnly === true,
      },
    });

    const output = await listQaReviewsForAccount(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.list-reviews',
      target: output.accountId,
      mutated: false,
      output: {
        accountId: output.accountId,
        accountName: output.accountName,
        reviewCount: output.reviews.length,
        failingOnly: output.failingOnly,
      },
    });

    return output;
  },
};

export function parseQaHistoryCommandArgs(
  args: string,
  opts: { failingOnly?: boolean } = {},
): ListQaReviewsSkillInput {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let failingOnly = opts.failingOnly === true;
  const filtered = tokens.filter((token) => {
    if (['--failures', '--failed', '--failing'].includes(token.toLowerCase())) {
      failingOnly = true;
      return false;
    }
    return true;
  });

  const lastToken = filtered[filtered.length - 1];
  const limit = lastToken && /^\d+$/.test(lastToken) ? Number(lastToken) : undefined;
  const accountTokens = limit ? filtered.slice(0, -1) : filtered;
  const accountQuery = accountTokens.join(' ').trim();

  if (!accountQuery) {
    throw new ValidationError('Usage: /ops qa-history <account name> [limit]');
  }

  return { accountQuery, limit, failingOnly };
}

export function formatQaReviewHistoryOutput(output: ListQaReviewsOutput): string {
  if (output.reviews.length === 0) {
    return [
      output.failingOnly ? 'No failing QA reviews found.' : 'No QA reviews found.',
      `Account: ${output.accountName}`,
    ].join('\n');
  }

  return [
    output.failingOnly ? 'Recent failing QA reviews:' : 'Recent QA reviews:',
    `Account: ${output.accountName}`,
    `Showing: ${output.reviews.length} of up to ${output.limit}`,
    '',
    ...output.reviews.map(formatQaHistoryLine),
  ].join('\n');
}

function formatQaHistoryLine(review: QaReviewRecord): string {
  const call = review.callId ? `call ${review.callId}` : 'manual review';
  return [
    `- ${review.reviewedAt} - ${review.score}/100 ${review.pass ? 'PASS' : 'FAIL'} (${call})`,
    `  Trigger: ${review.reviewTrigger}; findings: ${review.findings.length}; model: ${review.modelUsed}`,
    `  Summary: ${truncate(review.summary, 180)}`,
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}
