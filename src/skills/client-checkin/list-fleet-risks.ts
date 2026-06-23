import { z } from 'zod';
import {
  fetchClientCheckinFleetSummary,
  type ClientCheckinFleetAttentionRecord,
  type ClientCheckinFleetSummary,
} from '../../lib/client-checkin/fleet-summary.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const listClientCheckinFleetRisksInputSchema = z.object({
  sinceHours: z.number().int().min(1).max(720).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export type ListClientCheckinFleetRisksInput = z.infer<
  typeof listClientCheckinFleetRisksInputSchema
>;

export const clientCheckinListFleetRisksSkill: Skill<
  ListClientCheckinFleetRisksInput,
  ClientCheckinFleetSummary
> = {
  id: 'client-checkin.list-fleet-risks',
  description: 'Summarize recent at-risk client check-in briefs across the fleet',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: listClientCheckinFleetRisksInputSchema,
  async execute(input, ctx: SkillContext): Promise<ClientCheckinFleetSummary> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.list-fleet-risks',
      target: 'fleet',
      mutated: false,
      input,
    });

    const output = await fetchClientCheckinFleetSummary(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.list-fleet-risks',
      target: 'fleet',
      mutated: false,
      output: {
        sinceHours: output.sinceHours,
        totalBriefs: output.totalBriefs,
        attentionBriefs: output.attentionBriefs,
        attentionRate: output.attentionRate,
        recentAttentionCount: output.recentAttention.length,
      },
    });

    return output;
  },
};

export function parseClientCheckinFleetSummaryCommandArgs(
  args: string,
): ListClientCheckinFleetRisksInput {
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

    throw new ValidationError('Usage: /ops checkin-fleet-summary [hours] [--limit=N]');
  }

  return { sinceHours, limit };
}

export function formatClientCheckinFleetSummaryOutput(output: ClientCheckinFleetSummary): string {
  const heading =
    output.attentionBriefs === 0
      ? 'Client check-in fleet summary.'
      : 'Client check-in fleet attention summary.';
  const lines = [
    heading,
    `Window: last ${output.sinceHours} hour(s) since ${output.since}`,
    `Generated at: ${output.generatedAt}`,
    '',
    'Summary',
    `- Briefs: ${output.totalBriefs}`,
    `- Healthy: ${output.healthyBriefs}`,
    `- Watch: ${output.watchBriefs}`,
    `- At risk: ${output.atRiskBriefs}`,
    `- Attention rate: ${output.attentionRate.toFixed(1)}%`,
  ];

  if (output.totalBriefs === 0) {
    lines.push('', 'No client check-in briefs found in this window.');
    return lines.join('\n');
  }

  if (output.attentionBriefs === 0) {
    lines.push('', 'No watch or at-risk client check-in briefs found in this window.');
    return lines.join('\n');
  }

  lines.push('', 'Top attention accounts:');
  for (const account of output.topAccounts) {
    lines.push(
      `- ${account.accountName}: ${account.attentionBriefs} attention brief(s) / ${account.totalBriefs} total; latest ${formatStatus(
        account.latestStatus,
      )} at ${account.latestGeneratedAt}`,
    );
  }

  if (output.topIssueSystems.length > 0) {
    lines.push('', 'Top issue systems:');
    for (const system of output.topIssueSystems) {
      lines.push(`- ${system.system}: ${system.issueCount} issue(s)`);
    }
  }

  lines.push('', `Recent watch/at-risk briefs (up to ${output.limit}):`);
  for (const brief of output.recentAttention) {
    lines.push(formatClientCheckinFleetAttentionLine(brief));
  }

  return lines.join('\n');
}

function parsePositiveIntegerFlag(token: string, prefix: string): number {
  const value = token.slice(prefix.length);
  if (!/^\d+$/.test(value)) {
    throw new ValidationError('Usage: /ops checkin-fleet-summary [hours] [--limit=N]');
  }
  return Number(value);
}

function formatClientCheckinFleetAttentionLine(brief: ClientCheckinFleetAttentionRecord): string {
  return [
    `- ${brief.generatedAt} - ${brief.accountName} - ${formatStatus(brief.status)} (${brief.id})`,
    `  Issues: ${brief.openIssueCount}; questions: ${brief.followUpQuestionCount}; model: ${brief.modelUsed}`,
    `  Summary: ${truncate(brief.summary, 180)}`,
  ].join('\n');
}

function formatStatus(status: 'healthy' | 'watch' | 'at_risk'): string {
  return status.replace('_', ' ').toUpperCase();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
