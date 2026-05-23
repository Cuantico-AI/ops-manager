import { z } from 'zod';
import {
  fetchOpsFleetDigest,
  type OpsFleetDigestAccountSignal,
  type OpsFleetDigestSummary,
} from '../../lib/ops/fleet-digest.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const opsFleetDigestInputSchema = z.object({
  sinceHours: z.number().int().min(1).max(168).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export type OpsFleetDigestInput = z.infer<typeof opsFleetDigestInputSchema>;

export const opsFleetDigestSkill: Skill<OpsFleetDigestInput, OpsFleetDigestSummary> = {
  id: 'ops.fleet-digest',
  description: 'Summarize cross-role Phase 5 fleet attention signals',
  mutates: false,
  requiresApproval: false,
  schema: opsFleetDigestInputSchema,
  async execute(input, ctx: SkillContext): Promise<OpsFleetDigestSummary> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ops.fleet-digest',
      target: 'fleet',
      mutated: false,
      input,
    });

    const output = await fetchOpsFleetDigest(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ops.fleet-digest',
      target: 'fleet',
      mutated: false,
      output: {
        sinceHours: output.sinceHours,
        totalAttentionSignals: output.totalAttentionSignals,
        accountsWithAttention: output.accountsWithAttention,
        multiSignalAccounts: output.multiSignalAccounts.length,
        qaFailedReviews: output.qa.failedReviews,
        clientCheckinAttentionBriefs: output.clientCheckin.attentionBriefs,
        promptOpsAttentionReviews: output.promptOps.attentionReviews,
      },
    });

    return output;
  },
};

export function parseOpsFleetDigestCommandArgs(args: string): OpsFleetDigestInput {
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

    throw new ValidationError('Usage: /ops fleet-digest [hours] [--limit=N]');
  }

  return { sinceHours, limit };
}

export function formatOpsFleetDigestOutput(output: OpsFleetDigestSummary): string {
  const heading =
    output.totalAttentionSignals === 0 ? 'Ops fleet digest.' : 'Ops fleet attention digest.';
  const lines = [
    heading,
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
    `- Accounts with attention: ${output.accountsWithAttention}`,
    `- Multi-signal accounts: ${output.multiSignalAccounts.length}`,
  ];

  if (output.totalAttentionSignals === 0) {
    lines.push('', 'No Phase 5 fleet attention signals found in this window.');
    return lines.join('\n');
  }

  if (output.multiSignalAccounts.length > 0) {
    lines.push('', `Cross-role attention accounts (up to ${output.limit}):`);
    for (const account of output.multiSignalAccounts) {
      lines.push(formatOpsFleetDigestAccountLine(account));
    }
  }

  lines.push('', `Top attention accounts (up to ${output.limit}):`);
  for (const account of output.topAccounts) {
    lines.push(formatOpsFleetDigestAccountLine(account));
  }

  if (output.qa.failedReviews > 0) {
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
    throw new ValidationError('Usage: /ops fleet-digest [hours] [--limit=N]');
  }
  return Number(value);
}

function formatOpsFleetDigestAccountLine(account: OpsFleetDigestAccountSignal): string {
  const latest = account.latestSignalAt ? `; latest ${account.latestSignalAt}` : '';
  return `- ${account.accountName}: ${account.attentionSignals} signal(s) across ${account.signalCategories} area(s) - QA failures ${account.qaFailures}/${account.qaReviews}, check-ins ${account.clientCheckinAttention}/${account.clientCheckinBriefs}, Prompt Ops ${account.promptOpsAttention}/${account.promptOpsReviews}${latest}`;
}
