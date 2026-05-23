import { z } from 'zod';
import {
  listClientCheckinBriefsForAccount,
  type ClientCheckinBriefRecord,
  type ListClientCheckinBriefsOutput,
} from '../../lib/client-checkin/briefs.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const listClientCheckinBriefsInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export type ListClientCheckinBriefsSkillInput = z.infer<typeof listClientCheckinBriefsInputSchema>;

export const clientCheckinListBriefsSkill: Skill<
  ListClientCheckinBriefsSkillInput,
  ListClientCheckinBriefsOutput
> = {
  id: 'client-checkin.list-briefs',
  description: 'List recent persisted client check-in briefs for an account',
  mutates: false,
  requiresApproval: false,
  schema: listClientCheckinBriefsInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListClientCheckinBriefsOutput> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.list-briefs',
      target: input.accountId ?? input.accountQuery ?? 'unknown',
      mutated: false,
      input: {
        accountId: input.accountId,
        accountQuery: input.accountQuery,
        limit: input.limit,
      },
    });

    const output = await listClientCheckinBriefsForAccount(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.list-briefs',
      target: output.accountId,
      mutated: false,
      output: {
        accountId: output.accountId,
        accountName: output.accountName,
        briefCount: output.briefs.length,
      },
    });

    return output;
  },
};

export function parseClientCheckinHistoryCommandArgs(
  args: string,
): ListClientCheckinBriefsSkillInput {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1];
  const limit = lastToken && /^\d+$/.test(lastToken) ? Number(lastToken) : undefined;
  const accountTokens = limit ? tokens.slice(0, -1) : tokens;
  const accountQuery = accountTokens.join(' ').trim();

  if (!accountQuery) {
    throw new ValidationError('Usage: /ops checkin-history <account name> [limit]');
  }

  return { accountQuery, limit };
}

export function formatClientCheckinBriefHistoryOutput(
  output: ListClientCheckinBriefsOutput,
): string {
  if (output.briefs.length === 0) {
    return ['No client check-in briefs found.', `Account: ${output.accountName}`].join('\n');
  }

  return [
    'Recent client check-in briefs:',
    `Account: ${output.accountName}`,
    `Showing: ${output.briefs.length} of up to ${output.limit}`,
    '',
    ...output.briefs.map(formatClientCheckinHistoryLine),
  ].join('\n');
}

function formatClientCheckinHistoryLine(brief: ClientCheckinBriefRecord): string {
  return [
    `- ${brief.generatedAt} - ${brief.status.replace('_', ' ').toUpperCase()} (${brief.id})`,
    `  Issues: ${brief.openIssues.length}; questions: ${brief.followUpQuestions.length}; model: ${brief.modelUsed}`,
    `  Summary: ${truncate(brief.summary, 180)}`,
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}
