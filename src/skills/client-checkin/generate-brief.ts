import { z } from 'zod';
import { CLIENT_CHECKIN_SYSTEM_PROMPT } from '../../agents/client-checkin/system-prompt.js';
import {
  fetchClientCheckinSignals,
  type ClientCheckinSignals,
} from '../../lib/client-checkin/health-signals.js';
import { ExternalServiceError, ValidationError } from '../../lib/errors.js';
import type { LiteLLMClient } from '../../lib/llm/client.js';
import type { Skill, SkillContext } from '../_types.js';

export const generateClientCheckinBriefInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  includeInactive: z.boolean().optional(),
  model: z.string().trim().min(1).optional(),
});

export type GenerateClientCheckinBriefInput = z.infer<typeof generateClientCheckinBriefInputSchema>;

export const clientCheckinOpenIssueSchema = z.object({
  system: z.enum(['ghl', 'assistable', 'n8n', 'ops', 'other']),
  severity: z.enum(['critical', 'major', 'minor', 'info']),
  detail: z.string().trim().min(1),
  suggestedAction: z.string().trim().min(1).optional(),
});

export const clientCheckinBriefSchema = z.object({
  status: z.enum(['healthy', 'watch', 'at_risk']),
  summary: z.string().trim().min(1),
  talkingPoints: z.array(z.string().trim().min(1)),
  openIssues: z.array(clientCheckinOpenIssueSchema),
  followUpQuestions: z.array(z.string().trim().min(1)),
});

export type ClientCheckinOpenIssue = z.infer<typeof clientCheckinOpenIssueSchema>;
export type ClientCheckinBrief = z.infer<typeof clientCheckinBriefSchema>;

export interface GenerateClientCheckinBriefOutput extends ClientCheckinBrief {
  accountId: string;
  accountName: string;
  generatedAt: string;
  modelUsed: string;
  signals: ClientCheckinSignals;
}

export const clientCheckinGenerateBriefSkill: Skill<
  GenerateClientCheckinBriefInput,
  GenerateClientCheckinBriefOutput
> = {
  id: 'client-checkin.generate-brief',
  description: 'Generate a client check-in brief from stored account health signals',
  mutates: false,
  requiresApproval: false,
  schema: generateClientCheckinBriefInputSchema,
  async execute(input, ctx: SkillContext): Promise<GenerateClientCheckinBriefOutput> {
    const signals = await fetchClientCheckinSignals(input);
    const generatedAt = new Date().toISOString();
    const model = input.model ?? getClientCheckinModel();

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.generate-brief',
      target: signals.accountId,
      mutated: false,
      input: {
        accountId: signals.accountId,
        accountName: signals.accountName,
        ghlStatus: signals.ghl.status,
        assistableStatus: signals.assistable.status,
        n8nStatus: signals.n8n.status,
        n8nWorkflowCount: signals.n8n.workflowCount,
      },
    });

    const brief = await generateClientCheckinBrief({ signals, model }, ctx.llm);
    const output: GenerateClientCheckinBriefOutput = {
      accountId: signals.accountId,
      accountName: signals.accountName,
      generatedAt,
      modelUsed: model,
      signals,
      ...brief,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'client-checkin.generate-brief',
      target: signals.accountId,
      mutated: false,
      output: {
        status: output.status,
        talkingPointCount: output.talkingPoints.length,
        openIssueCount: output.openIssues.length,
        followUpQuestionCount: output.followUpQuestions.length,
      },
    });

    return output;
  },
};

export function parseClientCheckinCommandArgs(args: string): { accountQuery: string } {
  const accountQuery = args.trim();
  if (!accountQuery) {
    throw new ValidationError('Usage: /ops client-checkin <account name>');
  }

  return { accountQuery };
}

export function formatClientCheckinBriefOutput(output: GenerateClientCheckinBriefOutput): string {
  const lines = [
    'Client check-in brief ready.',
    `Account: ${output.accountName}`,
    `Status: ${formatStatus(output.status)}`,
    `Model: ${output.modelUsed}`,
    `Generated at: ${output.generatedAt}`,
    '',
    `Summary: ${output.summary}`,
    '',
    'Current signals:',
    `• GHL PIT token: ${output.signals.ghl.status} (${formatCheckedAt(output.signals.ghl.checkedAt)})`,
    `• Assistable OAuth: ${output.signals.assistable.status} (${formatCheckedAt(
      output.signals.assistable.checkedAt,
    )})`,
    `• n8n workflows: ${output.signals.n8n.status}, ${output.signals.n8n.workflowCount} tracked (${formatCheckedAt(
      output.signals.n8n.checkedAt,
    )})`,
    '',
    'Talking points:',
    ...formatList(output.talkingPoints),
    '',
  ];

  if (output.openIssues.length === 0) {
    lines.push('Open issues: none');
  } else {
    lines.push(
      'Open issues:',
      ...output.openIssues.map((issue) => {
        const action = issue.suggestedAction ? ` Next: ${issue.suggestedAction}` : '';
        return `• [${issue.severity.toUpperCase()}] ${issue.system}: ${issue.detail}${action}`;
      }),
    );
  }

  if (output.followUpQuestions.length > 0) {
    lines.push('', 'Follow-up questions:', ...formatList(output.followUpQuestions));
  }

  return lines.join('\n');
}

export function parseClientCheckinModelOutput(content: string): ClientCheckinBrief {
  const jsonText = extractJsonObject(content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ExternalServiceError(
      'Client check-in model returned invalid JSON',
      'CLIENT_CHECKIN_INVALID_JSON',
    );
  }

  const result = clientCheckinBriefSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExternalServiceError(
      `Client check-in model returned invalid schema: ${result.error.message}`,
      'CLIENT_CHECKIN_INVALID_SCHEMA',
    );
  }

  return result.data;
}

export function getClientCheckinModel(): string {
  return process.env.CLIENT_CHECKIN_MODEL ?? 'ops-claude-sonnet';
}

async function generateClientCheckinBrief(
  input: {
    signals: ClientCheckinSignals;
    model: string;
  },
  llm: LiteLLMClient,
): Promise<ClientCheckinBrief> {
  const response = await llm.chat({
    model: input.model,
    messages: [
      { role: 'system', content: CLIENT_CHECKIN_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'Prepare a client check-in brief from these account health signals.',
          '',
          JSON.stringify(input.signals, null, 2),
        ].join('\n'),
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new ExternalServiceError(
      'Client check-in model returned empty content',
      'CLIENT_CHECKIN_EMPTY',
    );
  }

  return parseClientCheckinModelOutput(content);
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function formatStatus(status: ClientCheckinBrief['status']): string {
  return status.replace('_', ' ').toUpperCase();
}

function formatCheckedAt(checkedAt: string | null): string {
  return checkedAt ? `checked ${checkedAt}` : 'not checked yet';
}

function formatList(items: string[]): string[] {
  return items.length ? items.map((item) => `• ${item}`) : ['• none'];
}
