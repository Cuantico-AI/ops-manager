import { z } from 'zod';
import {
  fetchOpsAccountDigest,
  type OpsAccountDigestClientCheckinAttention,
  type OpsAccountDigestPromptOpsAttention,
  type OpsAccountDigestQaFailure,
  type OpsAccountDigestSummary,
} from '../../lib/ops/account-digest.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

const USAGE = 'Usage: /ops account-digest <account name> [hours] [--limit=N]';

export const opsAccountDigestInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  sinceHours: z.number().int().min(1).max(168).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export type OpsAccountDigestInput = z.infer<typeof opsAccountDigestInputSchema>;

export const opsAccountDigestSkill: Skill<OpsAccountDigestInput, OpsAccountDigestSummary> = {
  id: 'ops.account-digest',
  description: 'Summarize Phase 5 attention signals for one account',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: opsAccountDigestInputSchema,
  async execute(input, ctx: SkillContext): Promise<OpsAccountDigestSummary> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ops.account-digest',
      target: input.accountId ?? input.accountQuery ?? 'unknown',
      mutated: false,
      input,
    });

    const output = await fetchOpsAccountDigest(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ops.account-digest',
      target: output.accountId,
      mutated: false,
      output: {
        accountId: output.accountId,
        accountName: output.accountName,
        sinceHours: output.sinceHours,
        signalCategories: output.signalCategories,
        totalAttentionSignals: output.totalAttentionSignals,
        qaFailedReviews: output.qa.failedReviews,
        clientCheckinAttentionBriefs: output.clientCheckin.attentionBriefs,
        promptOpsAttentionReviews: output.promptOps.attentionReviews,
      },
    });

    return output;
  },
};

export function parseOpsAccountDigestCommandArgs(args: string): OpsAccountDigestInput {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let sinceHours: number | undefined;
  let limit: number | undefined;
  const accountTokens: string[] = [];

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
    if (lower.startsWith('--')) {
      throw new ValidationError(USAGE);
    }
    accountTokens.push(token);
  }

  const lastToken = accountTokens[accountTokens.length - 1];
  if (lastToken && /^\d+$/.test(lastToken)) {
    if (sinceHours !== undefined) {
      throw new ValidationError(USAGE);
    }
    sinceHours = Number(lastToken);
    accountTokens.pop();
  }

  const accountQuery = accountTokens.join(' ').trim();
  if (!accountQuery) {
    throw new ValidationError(USAGE);
  }

  return { accountQuery, sinceHours, limit };
}

export function formatOpsAccountDigestOutput(output: OpsAccountDigestSummary): string {
  const heading =
    output.totalAttentionSignals === 0
      ? 'Ops account digest.'
      : 'Ops account attention digest.';
  const lines = [
    heading,
    `Account: ${output.accountName}`,
    `Window: last ${output.sinceHours} hour(s) since ${output.since}`,
    `Generated at: ${output.generatedAt}`,
    '',
    'Summary',
    `- QA reviews: ${output.qa.totalReviews}; failed: ${output.qa.failedReviews}; pass rate: ${output.qa.passRate.toFixed(
      1,
    )}%`,
    `- Client check-ins: ${output.clientCheckin.totalBriefs}; watch/at-risk: ${output.clientCheckin.attentionBriefs}; attention rate: ${output.clientCheckin.attentionRate.toFixed(
      1,
    )}%`,
    `- Prompt Ops reviews: ${output.promptOps.totalReviews}; blocked/high-risk: ${output.promptOps.attentionReviews}; attention rate: ${output.promptOps.attentionRate.toFixed(
      1,
    )}%`,
    `- Total attention signals: ${output.totalAttentionSignals}`,
    `- Signal categories: ${output.signalCategories}`,
    `- Latest signal: ${output.latestSignalAt ?? 'none'}`,
  ];

  if (output.totalAttentionSignals === 0) {
    lines.push('', 'No Phase 5 attention signals found for this account in this window.');
    return lines.join('\n');
  }

  if (output.qa.failures.length > 0) {
    lines.push('', `Recent QA failures (up to ${output.limit}):`);
    for (const failure of output.qa.failures) {
      lines.push(formatQaFailureLine(failure));
    }
  }

  if (output.clientCheckin.recentAttention.length > 0) {
    lines.push('', `Recent client check-in attention (up to ${output.limit}):`);
    for (const brief of output.clientCheckin.recentAttention) {
      lines.push(formatClientCheckinAttentionLine(brief));
    }
  }

  if (output.promptOps.recentAttention.length > 0) {
    lines.push('', `Recent Prompt Ops attention (up to ${output.limit}):`);
    for (const review of output.promptOps.recentAttention) {
      lines.push(formatPromptOpsAttentionLine(review));
    }
  }

  if (output.qa.topTriggers.length > 0) {
    lines.push('', 'QA failure triggers:');
    for (const trigger of output.qa.topTriggers) {
      lines.push(
        `- ${trigger.reviewTrigger}: ${trigger.failedReviews} failure(s) / ${trigger.totalReviews} review(s)`,
      );
    }
  }

  if (output.clientCheckin.topIssueSystems.length > 0) {
    lines.push('', 'Client check-in issue systems:');
    for (const system of output.clientCheckin.topIssueSystems) {
      lines.push(`- ${system.system}: ${system.issueCount} issue(s)`);
    }
  }

  if (output.promptOps.riskBreakdown.length > 0) {
    lines.push('', 'Prompt Ops risk breakdown:');
    for (const risk of output.promptOps.riskBreakdown) {
      lines.push(
        `- ${risk.riskLevel.toUpperCase()}: ${risk.totalReviews} review(s), ${risk.blockedReviews} blocked`,
      );
    }
  }

  return lines.join('\n');
}

function parsePositiveIntegerFlag(token: string, prefix: string): number {
  const value = token.slice(prefix.length);
  if (!/^\d+$/.test(value)) {
    throw new ValidationError(USAGE);
  }
  return Number(value);
}

function formatQaFailureLine(failure: OpsAccountDigestQaFailure): string {
  const call = failure.callId ? `call ${failure.callId}` : 'manual review';
  return [
    `- ${failure.reviewedAt} - ${failure.score}/100 FAIL (${call})`,
    `  Trigger: ${failure.reviewTrigger}; findings: ${failure.findingCount}; model: ${failure.modelUsed}`,
    `  Summary: ${truncate(failure.summary, 180)}`,
  ].join('\n');
}

function formatClientCheckinAttentionLine(
  brief: OpsAccountDigestClientCheckinAttention,
): string {
  return [
    `- ${brief.generatedAt} - ${brief.status.replace('_', ' ').toUpperCase()} (${brief.id})`,
    `  Issues: ${brief.openIssueCount}; questions: ${brief.followUpQuestionCount}; model: ${brief.modelUsed}`,
    `  Summary: ${truncate(brief.summary, 180)}`,
  ].join('\n');
}

function formatPromptOpsAttentionLine(review: OpsAccountDigestPromptOpsAttention): string {
  return [
    `- ${review.reviewedAt} - ${review.riskLevel.toUpperCase()}${
      review.blocked ? ' BLOCKED' : ''
    } (${review.id})`,
    `  Recommended changes: ${review.recommendedChangeCount}; tests: ${review.testPlanCount}; blockers: ${review.blockerCount}; model: ${review.modelUsed}`,
    `  Summary: ${truncate(review.summary, 180)}`,
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}
