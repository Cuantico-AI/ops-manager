import { z } from 'zod';
import {
  fetchPromptOpsFleetSummary,
  type PromptOpsFleetAttentionRecord,
  type PromptOpsFleetSummary,
} from '../../lib/prompt-ops/fleet-summary.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const listPromptOpsFleetRisksInputSchema = z.object({
  sinceHours: z.number().int().min(1).max(720).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export type ListPromptOpsFleetRisksInput = z.infer<typeof listPromptOpsFleetRisksInputSchema>;

export const promptOpsListFleetRisksSkill: Skill<
  ListPromptOpsFleetRisksInput,
  PromptOpsFleetSummary
> = {
  id: 'prompt-ops.list-fleet-risks',
  description: 'Summarize recent blocked and high-risk Prompt Ops reviews across the fleet',
  mutates: false,
  requiresApproval: false,
  schema: listPromptOpsFleetRisksInputSchema,
  async execute(input, ctx: SkillContext): Promise<PromptOpsFleetSummary> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.list-fleet-risks',
      target: 'fleet',
      mutated: false,
      input,
    });

    const output = await fetchPromptOpsFleetSummary(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.list-fleet-risks',
      target: 'fleet',
      mutated: false,
      output: {
        sinceHours: output.sinceHours,
        totalReviews: output.totalReviews,
        blockedReviews: output.blockedReviews,
        highRiskReviews: output.highRiskReviews,
        attentionReviews: output.attentionReviews,
        attentionRate: output.attentionRate,
        recentAttentionCount: output.recentAttention.length,
      },
    });

    return output;
  },
};

export function parsePromptOpsFleetSummaryCommandArgs(args: string): ListPromptOpsFleetRisksInput {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let sinceHours: number | undefined;
  let limit: number | undefined;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('--hours=')) {
      sinceHours = parsePositiveIntegerFlag(token, '--hours=');
      continue;
    }
    if (lower.startsWith('--limit=')) {
      limit = parsePositiveIntegerFlag(token, '--limit=');
      continue;
    }
    if (/^\d+$/.test(token) && sinceHours === undefined) {
      sinceHours = Number(token);
      continue;
    }

    throw new ValidationError('Usage: /ops prompt-fleet-summary [hours] [--limit=N]');
  }

  return { sinceHours, limit };
}

export function formatPromptOpsFleetSummaryOutput(output: PromptOpsFleetSummary): string {
  const heading =
    output.attentionReviews === 0
      ? 'Prompt Ops fleet summary.'
      : 'Prompt Ops fleet attention summary.';
  const lines = [
    heading,
    `Window: last ${output.sinceHours} hour(s) since ${output.since}`,
    `Generated at: ${output.generatedAt}`,
    '',
    'Summary',
    `- Reviews: ${output.totalReviews}`,
    `- Low risk: ${output.lowRiskReviews}`,
    `- Medium risk: ${output.mediumRiskReviews}`,
    `- High risk: ${output.highRiskReviews}`,
    `- Blocked: ${output.blockedReviews}`,
    `- Attention rate: ${output.attentionRate.toFixed(1)}%`,
  ];

  if (output.totalReviews === 0) {
    lines.push('', 'No Prompt Ops reviews found in this window.');
    return lines.join('\n');
  }

  if (output.attentionReviews === 0) {
    lines.push('', 'No blocked or high-risk Prompt Ops reviews found in this window.');
    return lines.join('\n');
  }

  lines.push('', 'Top attention accounts:');
  for (const account of output.topAccounts) {
    lines.push(
      `- ${account.accountName}: ${account.attentionReviews} attention review(s) / ${account.totalReviews} total; ${account.blockedReviews} blocked, ${account.highRiskReviews} high-risk; latest ${formatRisk(
        account.latestRiskLevel,
      )}${account.latestBlocked ? ' BLOCKED' : ''} at ${account.latestReviewedAt}`,
    );
  }

  if (output.riskBreakdown.length > 0) {
    lines.push('', 'Risk breakdown:');
    for (const risk of output.riskBreakdown) {
      lines.push(
        `- ${formatRisk(risk.riskLevel)}: ${risk.totalReviews} review(s), ${risk.blockedReviews} blocked`,
      );
    }
  }

  lines.push('', `Recent blocked/high-risk reviews (up to ${output.limit}):`);
  for (const review of output.recentAttention) {
    lines.push(formatPromptOpsFleetAttentionLine(review));
  }

  return lines.join('\n');
}

function parsePositiveIntegerFlag(token: string, prefix: string): number {
  const value = token.slice(prefix.length);
  if (!/^\d+$/.test(value)) {
    throw new ValidationError('Usage: /ops prompt-fleet-summary [hours] [--limit=N]');
  }
  return Number(value);
}

function formatPromptOpsFleetAttentionLine(review: PromptOpsFleetAttentionRecord): string {
  return [
    `- ${review.reviewedAt} - ${review.accountName} - ${formatRisk(review.riskLevel)}${
      review.blocked ? ' BLOCKED' : ''
    } (${review.id})`,
    `  Recommended changes: ${review.recommendedChangeCount}; tests: ${review.testPlanCount}; blockers: ${review.blockerCount}; model: ${review.modelUsed}`,
    `  Summary: ${truncate(review.summary, 180)}`,
  ].join('\n');
}

function formatRisk(riskLevel: 'low' | 'medium' | 'high'): string {
  return riskLevel.toUpperCase();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
