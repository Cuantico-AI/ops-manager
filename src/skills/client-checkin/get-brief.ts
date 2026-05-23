import { z } from 'zod';
import {
  getClientCheckinBriefById,
  type ClientCheckinBriefRecord,
} from '../../lib/client-checkin/briefs.js';
import { ValidationError } from '../../lib/errors.js';
import type { Skill, SkillContext } from '../_types.js';

export const getClientCheckinBriefInputSchema = z.object({
  briefId: z.string().uuid(),
});

export type GetClientCheckinBriefInput = z.infer<typeof getClientCheckinBriefInputSchema>;

export const clientCheckinGetBriefSkill: Skill<
  GetClientCheckinBriefInput,
  ClientCheckinBriefRecord
> = {
  id: 'client-checkin.get-brief',
  description: 'Retrieve a persisted client check-in brief by ID',
  mutates: false,
  requiresApproval: false,
  schema: getClientCheckinBriefInputSchema,
  async execute(input, ctx: SkillContext): Promise<ClientCheckinBriefRecord> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.get-brief',
      target: input.briefId,
      mutated: false,
      input: {
        briefId: input.briefId,
      },
    });

    const output = await getClientCheckinBriefById(input.briefId);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.get-brief',
      target: output.accountId,
      mutated: false,
      output: {
        briefId: output.id,
        accountId: output.accountId,
        accountName: output.accountName,
        status: output.status,
        openIssueCount: output.openIssues.length,
      },
    });

    return output;
  },
};

export function parseClientCheckinShowCommandArgs(args: string): GetClientCheckinBriefInput {
  const briefId = args.trim();
  if (!briefId) {
    throw new ValidationError('Usage: /ops checkin-show <brief_id>');
  }
  return { briefId };
}

export function formatClientCheckinBriefRecordOutput(brief: ClientCheckinBriefRecord): string {
  const lines = [
    'Client check-in brief found.',
    `Brief ID: ${brief.id}`,
    `Account: ${brief.accountName}`,
    `Status: ${brief.status.replace('_', ' ').toUpperCase()}`,
    `Model: ${brief.modelUsed}`,
    `Generated at: ${brief.generatedAt}`,
    '',
    `Summary: ${brief.summary}`,
    '',
    'Current signals:',
    `- GHL PIT token: ${brief.signals.ghl.status} (${formatCheckedAt(brief.signals.ghl.checkedAt)})`,
    `- Assistable OAuth: ${brief.signals.assistable.status} (${formatCheckedAt(
      brief.signals.assistable.checkedAt,
    )})`,
    `- n8n workflows: ${brief.signals.n8n.status}, ${brief.signals.n8n.workflowCount} tracked (${formatCheckedAt(
      brief.signals.n8n.checkedAt,
    )})`,
    '',
    'Talking points:',
    ...formatList(brief.talkingPoints),
    '',
  ];

  if (brief.openIssues.length === 0) {
    lines.push('Open issues: none');
  } else {
    lines.push(
      'Open issues:',
      ...brief.openIssues.map((issue) => {
        const action = issue.suggestedAction ? ` Next: ${issue.suggestedAction}` : '';
        return `- [${issue.severity.toUpperCase()}] ${issue.system}: ${issue.detail}${action}`;
      }),
    );
  }

  if (brief.followUpQuestions.length > 0) {
    lines.push('', 'Follow-up questions:', ...formatList(brief.followUpQuestions));
  }

  return lines.join('\n');
}

function formatCheckedAt(checkedAt: string | null): string {
  return checkedAt ? `checked ${checkedAt}` : 'not checked yet';
}

function formatList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ['- none'];
}
