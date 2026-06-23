import { z } from 'zod';
import {
  listPromptOpsReviewsForAccount,
  type ListPromptOpsReviewsOutput,
  type PromptOpsReviewRecord,
} from '../../lib/prompt-ops/reviews.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const listPromptOpsReviewsInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  blockedOnly: z.boolean().optional(),
});

export type ListPromptOpsReviewsSkillInput = z.infer<typeof listPromptOpsReviewsInputSchema>;

export const promptOpsListReviewsSkill: Skill<
  ListPromptOpsReviewsSkillInput,
  ListPromptOpsReviewsOutput
> = {
  id: 'prompt-ops.list-reviews',
  description: 'List recent persisted Prompt Ops reviews for an account',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: listPromptOpsReviewsInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListPromptOpsReviewsOutput> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.list-reviews',
      target: input.accountId ?? input.accountQuery ?? 'unknown',
      mutated: false,
      input: {
        accountId: input.accountId,
        accountQuery: input.accountQuery,
        limit: input.limit,
        blockedOnly: input.blockedOnly === true,
      },
    });

    const output = await listPromptOpsReviewsForAccount(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.list-reviews',
      target: output.accountId,
      mutated: false,
      output: {
        accountId: output.accountId,
        accountName: output.accountName,
        reviewCount: output.reviews.length,
        blockedOnly: output.blockedOnly,
      },
    });

    return output;
  },
};

export function parsePromptOpsHistoryCommandArgs(
  args: string,
  opts: { blockedOnly?: boolean } = {},
): ListPromptOpsReviewsSkillInput {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let blockedOnly = opts.blockedOnly === true;
  const filtered = tokens.filter((token) => {
    if (['--blocked', '--blockers', '--blocked-only'].includes(token.toLowerCase())) {
      blockedOnly = true;
      return false;
    }
    return true;
  });

  const lastToken = filtered[filtered.length - 1];
  const limit = lastToken && /^\d+$/.test(lastToken) ? Number(lastToken) : undefined;
  const accountTokens = limit ? filtered.slice(0, -1) : filtered;
  const accountQuery = accountTokens.join(' ').trim();

  if (!accountQuery) {
    throw new ValidationError('Usage: /ops prompt-history <account name> [limit]');
  }

  return { accountQuery, limit, blockedOnly };
}

export function formatPromptOpsReviewHistoryOutput(output: ListPromptOpsReviewsOutput): string {
  if (output.reviews.length === 0) {
    return [
      output.blockedOnly ? 'No blocked Prompt Ops reviews found.' : 'No Prompt Ops reviews found.',
      `Account: ${output.accountName}`,
    ].join('\n');
  }

  return [
    output.blockedOnly ? 'Recent blocked Prompt Ops reviews:' : 'Recent Prompt Ops reviews:',
    `Account: ${output.accountName}`,
    `Showing: ${output.reviews.length} of up to ${output.limit}`,
    '',
    ...output.reviews.map(formatPromptOpsHistoryLine),
  ].join('\n');
}

function formatPromptOpsHistoryLine(review: PromptOpsReviewRecord): string {
  return [
    `- ${review.reviewedAt} - ${review.riskLevel.toUpperCase()}${
      review.blocked ? ' BLOCKED' : ''
    } (${review.id})`,
    `  Recommended changes: ${review.recommendedChanges.length}; tests: ${review.testPlan.length}; model: ${review.modelUsed}`,
    `  Summary: ${truncate(review.summary, 180)}`,
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}
