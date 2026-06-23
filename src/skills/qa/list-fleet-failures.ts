import { z } from 'zod';
import {
  fetchFleetQaSummary,
  type FleetQaFailureRecord,
  type FleetQaSummary,
} from '../../lib/qa/fleet-summary.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const listFleetQaFailuresInputSchema = z.object({
  sinceHours: z.number().int().min(1).max(168).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export type ListFleetQaFailuresInput = z.infer<typeof listFleetQaFailuresInputSchema>;

export const qaListFleetFailuresSkill: Skill<ListFleetQaFailuresInput, FleetQaSummary> = {
  id: 'qa.list-fleet-failures',
  description: 'Summarize recent QA failures across the fleet',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: listFleetQaFailuresInputSchema,
  async execute(input, ctx: SkillContext): Promise<FleetQaSummary> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.list-fleet-failures',
      target: 'fleet',
      mutated: false,
      input,
    });

    const output = await fetchFleetQaSummary(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.list-fleet-failures',
      target: 'fleet',
      mutated: false,
      output: {
        sinceHours: output.sinceHours,
        totalReviews: output.totalReviews,
        failedReviews: output.failedReviews,
        passRate: output.passRate,
        failureCount: output.failures.length,
      },
    });

    return output;
  },
};

export function parseQaFleetSummaryCommandArgs(args: string): ListFleetQaFailuresInput {
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

    throw new ValidationError('Usage: /ops qa-fleet-summary [hours] [--limit=N]');
  }

  return { sinceHours, limit };
}

export function formatQaFleetSummaryOutput(output: FleetQaSummary): string {
  const heading =
    output.failedReviews === 0 ? 'Fleet QA summary.' : 'Fleet QA failure summary.';
  const lines = [
    heading,
    `Window: last ${output.sinceHours} hour(s) since ${output.since}`,
    `Generated at: ${output.generatedAt}`,
    '',
    'Summary',
    `- Reviewed: ${output.totalReviews}`,
    `- Passed: ${output.passedReviews}`,
    `- Failed: ${output.failedReviews}`,
    `- Pass rate: ${output.passRate.toFixed(1)}%`,
    `- Escalated: ${output.escalatedReviews}`,
  ];

  if (output.totalReviews === 0) {
    lines.push('', 'No QA reviews found in this window.');
    return lines.join('\n');
  }

  if (output.failedReviews === 0) {
    lines.push('', 'No failing QA reviews found in this window.');
    return lines.join('\n');
  }

  lines.push('', 'Top failing accounts:');
  for (const account of output.topAccounts) {
    const averageScore =
      account.averageScore === null ? 'n/a' : `${account.averageScore}/100 avg`;
    lines.push(
      `- ${account.accountName}: ${account.failedReviews} failure(s) / ${account.totalReviews} review(s), ${averageScore}`,
    );
  }

  lines.push('', 'Top failure triggers:');
  for (const trigger of output.topTriggers) {
    lines.push(
      `- ${trigger.reviewTrigger}: ${trigger.failedReviews} failure(s) / ${trigger.totalReviews} review(s)`,
    );
  }

  lines.push('', `Recent failures (up to ${output.limit}):`);
  for (const failure of output.failures) {
    lines.push(formatFleetQaFailureLine(failure));
  }

  return lines.join('\n');
}

function parsePositiveIntegerFlag(token: string, prefix: string): number {
  const value = token.slice(prefix.length);
  if (!/^\d+$/.test(value)) {
    throw new ValidationError('Usage: /ops qa-fleet-summary [hours] [--limit=N]');
  }
  return Number(value);
}

function formatFleetQaFailureLine(failure: FleetQaFailureRecord): string {
  const call = failure.callId ? `call ${failure.callId}` : 'manual review';
  return [
    `- ${failure.reviewedAt} - ${failure.accountName} - ${failure.score}/100 FAIL (${call})`,
    `  Trigger: ${failure.reviewTrigger}; type: ${failure.callType}; findings: ${failure.findingCount}; model: ${failure.modelUsed}${
      failure.escalated ? ' (escalated)' : ''
    }`,
    `  Summary: ${truncate(failure.summary, 180)}`,
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
