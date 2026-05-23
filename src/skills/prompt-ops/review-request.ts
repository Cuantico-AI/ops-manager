import { z } from 'zod';
import { PROMPT_OPS_SYSTEM_PROMPT } from '../../agents/prompt-ops/system-prompt.js';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { ExternalServiceError, ValidationError } from '../../lib/errors.js';
import type { LiteLLMClient } from '../../lib/llm/client.js';
import type { Skill, SkillContext } from '../_types.js';

const PROMPT_OPS_DELIMITER = ' :: ';
const DEFAULT_MAX_CONTEXT_CHARS = 30_000;

export const reviewPromptOpsRequestInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  request: z.string().trim().min(10),
  currentPrompt: z.string().trim().min(1).optional(),
  conversationSample: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
});

export type ReviewPromptOpsRequestInput = z.infer<typeof reviewPromptOpsRequestInputSchema>;

export const promptOpsReviewSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  blocked: z.boolean(),
  summary: z.string().trim().min(1),
  intendedOutcome: z.string().trim().min(1),
  recommendedChanges: z.array(z.string().trim().min(1)),
  testPlan: z.array(z.string().trim().min(1)),
  rollbackPlan: z.array(z.string().trim().min(1)),
  clarifyingQuestions: z.array(z.string().trim().min(1)),
  blockers: z.array(z.string().trim().min(1)),
});

export type PromptOpsReview = z.infer<typeof promptOpsReviewSchema>;

export interface ReviewPromptOpsRequestOutput extends PromptOpsReview {
  accountId: string;
  accountName: string;
  reviewedAt: string;
  modelUsed: string;
  requestChars: number;
  currentPromptChars: number;
  conversationSampleChars: number;
}

export const promptOpsReviewRequestSkill: Skill<
  ReviewPromptOpsRequestInput,
  ReviewPromptOpsRequestOutput
> = {
  id: 'prompt-ops.review-request',
  description: 'Review a prompt-change request and return a safe Prompt Ops brief',
  mutates: false,
  requiresApproval: false,
  schema: reviewPromptOpsRequestInputSchema,
  async execute(input, ctx: SkillContext): Promise<ReviewPromptOpsRequestOutput> {
    const account = await resolveAccountInput(input);
    const request = truncateContext(input.request);
    const currentPrompt = input.currentPrompt ? truncateContext(input.currentPrompt) : undefined;
    const conversationSample = input.conversationSample
      ? truncateContext(input.conversationSample)
      : undefined;
    const reviewedAt = new Date().toISOString();
    const model = input.model ?? getPromptOpsModel();

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.review-request',
      target: account.id,
      mutated: false,
      input: {
        accountId: account.id,
        accountName: account.name,
        requestChars: request.length,
        currentPromptChars: currentPrompt?.length ?? 0,
        conversationSampleChars: conversationSample?.length ?? 0,
      },
    });

    const review = await reviewPromptOpsRequest(
      {
        accountName: account.name,
        request,
        currentPrompt,
        conversationSample,
        model,
      },
      ctx.llm,
    );

    const output: ReviewPromptOpsRequestOutput = {
      accountId: account.id,
      accountName: account.name,
      reviewedAt,
      modelUsed: model,
      requestChars: request.length,
      currentPromptChars: currentPrompt?.length ?? 0,
      conversationSampleChars: conversationSample?.length ?? 0,
      ...review,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'prompt-ops.review-request',
      target: account.id,
      mutated: false,
      output: {
        riskLevel: output.riskLevel,
        blocked: output.blocked,
        recommendedChangeCount: output.recommendedChanges.length,
        testPlanCount: output.testPlan.length,
        blockerCount: output.blockers.length,
      },
    });

    return output;
  },
};

export function parsePromptOpsCommandArgs(args: string): {
  accountQuery: string;
  request: string;
} {
  const delimiterIndex = args.indexOf(PROMPT_OPS_DELIMITER);
  if (delimiterIndex === -1) {
    throw new ValidationError(
      `Usage: /ops prompt-ops <account name>${PROMPT_OPS_DELIMITER}<prompt change request>`,
    );
  }

  const accountQuery = args.slice(0, delimiterIndex).trim();
  const request = args.slice(delimiterIndex + PROMPT_OPS_DELIMITER.length).trim();

  if (!accountQuery) {
    throw new ValidationError('Account name is required before the :: delimiter');
  }
  if (request.length < 10) {
    throw new ValidationError('Prompt change request must be at least 10 characters');
  }

  return { accountQuery, request };
}

export function formatPromptOpsReviewOutput(output: ReviewPromptOpsRequestOutput): string {
  const lines = [
    'Prompt Ops brief ready.',
    `Account: ${output.accountName}`,
    `Risk: ${output.riskLevel.toUpperCase()}`,
    `Blocked: ${output.blocked ? 'yes' : 'no'}`,
    `Model: ${output.modelUsed}`,
    `Reviewed at: ${output.reviewedAt}`,
    `Context: request ${output.requestChars} chars, current prompt ${output.currentPromptChars} chars, sample ${output.conversationSampleChars} chars`,
    '',
    `Summary: ${output.summary}`,
    `Intended outcome: ${output.intendedOutcome}`,
    '',
    'Recommended changes:',
    ...formatList(output.recommendedChanges),
    '',
    'Test plan:',
    ...formatList(output.testPlan),
    '',
    'Rollback / monitoring:',
    ...formatList(output.rollbackPlan),
  ];

  if (output.clarifyingQuestions.length > 0) {
    lines.push('', 'Clarifying questions:', ...formatList(output.clarifyingQuestions));
  }

  if (output.blockers.length > 0) {
    lines.push('', 'Blockers:', ...formatList(output.blockers));
  }

  return lines.join('\n');
}

export function parsePromptOpsModelOutput(content: string): PromptOpsReview {
  const jsonText = extractJsonObject(content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ExternalServiceError(
      'Prompt Ops model returned invalid JSON',
      'PROMPT_OPS_INVALID_JSON',
    );
  }

  const result = promptOpsReviewSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExternalServiceError(
      `Prompt Ops model returned invalid schema: ${result.error.message}`,
      'PROMPT_OPS_INVALID_SCHEMA',
    );
  }

  return result.data;
}

export function getPromptOpsModel(): string {
  return process.env.PROMPT_OPS_MODEL ?? 'ops-claude-sonnet';
}

async function reviewPromptOpsRequest(
  input: {
    accountName: string;
    request: string;
    currentPrompt?: string;
    conversationSample?: string;
    model: string;
  },
  llm: LiteLLMClient,
): Promise<PromptOpsReview> {
  const response = await llm.chat({
    model: input.model,
    messages: [
      { role: 'system', content: PROMPT_OPS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Account: ${input.accountName}`,
          '',
          'Prompt-change request:',
          input.request,
          '',
          'Current prompt excerpt:',
          input.currentPrompt ?? 'Not provided.',
          '',
          'Conversation sample or QA notes:',
          input.conversationSample ?? 'Not provided.',
        ].join('\n'),
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new ExternalServiceError('Prompt Ops model returned empty content', 'PROMPT_OPS_EMPTY');
  }

  return parsePromptOpsModelOutput(content);
}

function truncateContext(value: string): string {
  const maxChars = Number(process.env.PROMPT_OPS_MAX_CONTEXT_CHARS ?? DEFAULT_MAX_CONTEXT_CHARS);
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[context truncated for Prompt Ops review]`;
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

function formatList(items: string[]): string[] {
  return items.length ? items.map((item) => `• ${item}`) : ['• none'];
}
