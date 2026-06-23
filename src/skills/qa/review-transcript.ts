import { z } from 'zod';
import { QA_REVIEW_SYSTEM_PROMPT } from '../../agents/qa-review/system-prompt.js';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { ExternalServiceError, ValidationError } from '../../lib/errors.js';
import {
  getQaAutoReviewModel,
  getQaManualReviewModel,
  getQaReviewEscalationModel,
} from '../../lib/qa/review-policy.js';
import type { LiteLLMClient } from '../../lib/llm/client.js';
import type { Skill, SkillContext } from '../_types.js';

const DEFAULT_MAX_TRANSCRIPT_CHARS = 50_000;
const QA_REVIEW_DELIMITER = ' :: ';

export const reviewTranscriptInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  transcript: z.string().trim().min(20),
  callType: z.enum(['inbound', 'outbound']).optional(),
  model: z.string().trim().min(1).optional(),
  callId: z.string().trim().min(1).optional(),
  reviewTrigger: z.enum(['sample', 'negative', 'error', 'failed_task', 'manual']).optional(),
});

export type ReviewTranscriptInput = z.infer<typeof reviewTranscriptInputSchema>;

export const qaFindingSchema = z.object({
  severity: z.enum(['critical', 'major', 'minor', 'info']),
  category: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  quote: z.string().trim().optional(),
});

export const qaReviewResultSchema = z.object({
  score: z.number().min(0).max(100),
  pass: z.boolean(),
  callType: z.enum(['inbound', 'outbound', 'unknown']),
  summary: z.string().trim().min(1),
  findings: z.array(qaFindingSchema),
});

export type QaFinding = z.infer<typeof qaFindingSchema>;
export type QaReviewResult = z.infer<typeof qaReviewResultSchema>;

export interface ReviewTranscriptOutput {
  accountId: string;
  accountName: string;
  callType: QaReviewResult['callType'];
  score: number;
  pass: boolean;
  summary: string;
  findings: QaFinding[];
  transcriptChars: number;
  reviewedAt: string;
  modelUsed: string;
  reviewTrigger?: ReviewTranscriptInput['reviewTrigger'];
  callId?: string;
}

export const qaReviewTranscriptSkill: Skill<ReviewTranscriptInput, ReviewTranscriptOutput> = {
  id: 'qa.review-transcript',
  description: 'Review an AI call or chat transcript and return structured QA findings',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: reviewTranscriptInputSchema,
  async execute(input, ctx: SkillContext): Promise<ReviewTranscriptOutput> {
    const account = await resolveAccountInput(input);
    const transcript = truncateTranscript(input.transcript);
    const reviewedAt = new Date().toISOString();

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.review-transcript',
      target: account.id,
      mutated: false,
      input: {
        accountId: account.id,
        accountName: account.name,
        transcriptChars: transcript.length,
        callType: input.callType,
      },
    });

    const review = await reviewTranscript(
      {
        accountName: account.name,
        transcript,
        callType: input.callType,
        model: input.model ?? getQaManualReviewModel(),
      },
      ctx.llm,
    );

    const output: ReviewTranscriptOutput = {
      accountId: account.id,
      accountName: account.name,
      callType: review.callType,
      score: review.score,
      pass: review.pass,
      summary: review.summary,
      findings: review.findings,
      transcriptChars: transcript.length,
      reviewedAt,
      modelUsed: input.model ?? getQaManualReviewModel(),
      reviewTrigger: input.reviewTrigger,
      callId: input.callId,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'qa.review-transcript',
      target: account.id,
      mutated: false,
      output: {
        score: output.score,
        pass: output.pass,
        findingCount: output.findings.length,
      },
    });

    return output;
  },
};

export function parseQaReviewCommandArgs(args: string): {
  accountQuery: string;
  transcript: string;
} {
  const delimiterIndex = args.indexOf(QA_REVIEW_DELIMITER);
  if (delimiterIndex === -1) {
    throw new ValidationError(
      `Usage: /ops qa-review <account name>${QA_REVIEW_DELIMITER}<transcript>`,
    );
  }

  const accountQuery = args.slice(0, delimiterIndex).trim();
  const transcript = args.slice(delimiterIndex + QA_REVIEW_DELIMITER.length).trim();

  if (!accountQuery) {
    throw new ValidationError('Account name is required before the :: delimiter');
  }
  if (transcript.length < 20) {
    throw new ValidationError('Transcript must be at least 20 characters after the :: delimiter');
  }

  return { accountQuery, transcript };
}

export function formatQaReviewOutput(output: ReviewTranscriptOutput): string {
  const lines = [
    'QA review complete.',
    `Account: ${output.accountName}`,
    `Score: ${output.score}/100 (${output.pass ? 'PASS' : 'FAIL'})`,
    `Call type: ${output.callType}`,
    `Model: ${output.modelUsed}`,
  ];

  if (output.reviewTrigger) {
    lines.push(`Trigger: ${output.reviewTrigger}`);
  }
  if (output.callId) {
    lines.push(`Call ID: ${output.callId}`);
  }

  lines.push(
    `Transcript length: ${output.transcriptChars} chars`,
    `Reviewed at: ${output.reviewedAt}`,
    '',
    `Summary: ${output.summary}`,
  );

  if (output.findings.length === 0) {
    lines.push('', 'Findings: none');
    return lines.join('\n');
  }

  lines.push('', 'Findings:');
  for (const [index, finding] of output.findings.entries()) {
    lines.push(
      `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.category}: ${finding.detail}`,
    );
    if (finding.quote) {
      lines.push(`   Quote: "${finding.quote}"`);
    }
  }

  return lines.join('\n');
}

function truncateTranscript(transcript: string): string {
  const maxChars = Number(
    process.env.QA_REVIEW_MAX_TRANSCRIPT_CHARS ?? DEFAULT_MAX_TRANSCRIPT_CHARS,
  );
  if (transcript.length <= maxChars) {
    return transcript;
  }

  return `${transcript.slice(0, maxChars)}\n\n[transcript truncated for review]`;
}

async function reviewTranscript(
  input: {
    accountName: string;
    transcript: string;
    callType?: 'inbound' | 'outbound';
    model: string;
  },
  llm: LiteLLMClient,
): Promise<QaReviewResult> {
  const callTypeHint = input.callType
    ? `Expected call type: ${input.callType}.`
    : 'Infer call type from context.';

  const response = await llm.chat({
    model: input.model,
    messages: [
      { role: 'system', content: QA_REVIEW_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Account: ${input.accountName}`,
          callTypeHint,
          '',
          'Transcript:',
          input.transcript,
        ].join('\n'),
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new ExternalServiceError('QA review model returned empty content', 'QA_REVIEW_EMPTY');
  }

  return parseQaReviewModelOutput(content);
}

export async function runEscalatedQaReview(
  input: ReviewTranscriptInput & { accountId: string; accountName: string },
  llm: LiteLLMClient,
): Promise<ReviewTranscriptOutput> {
  const transcript = truncateTranscript(input.transcript);
  const reviewedAt = new Date().toISOString();
  const primaryModel = input.model ?? getQaAutoReviewModel();
  const primary = await reviewTranscript(
    {
      accountName: input.accountName,
      transcript,
      callType: input.callType,
      model: primaryModel,
    },
    llm,
  );

  let finalReview = primary;
  let modelUsed = primaryModel;
  const escalationModel = getQaReviewEscalationModel();

  if (!primary.pass && escalationModel && escalationModel !== primaryModel) {
    finalReview = await reviewTranscript(
      {
        accountName: input.accountName,
        transcript,
        callType: input.callType,
        model: escalationModel,
      },
      llm,
    );
    modelUsed = escalationModel;
  }

  return {
    accountId: input.accountId,
    accountName: input.accountName,
    callType: finalReview.callType,
    score: finalReview.score,
    pass: finalReview.pass,
    summary: finalReview.summary,
    findings: finalReview.findings,
    transcriptChars: transcript.length,
    reviewedAt,
    modelUsed,
    reviewTrigger: input.reviewTrigger,
    callId: input.callId,
  };
}

export { getQaAutoReviewModel, getQaManualReviewModel, getQaReviewEscalationModel };

export function parseQaReviewModelOutput(content: string): QaReviewResult {
  const jsonText = extractJsonObject(content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ExternalServiceError(
      'QA review model returned invalid JSON',
      'QA_REVIEW_INVALID_JSON',
    );
  }

  const result = qaReviewResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExternalServiceError(
      `QA review model returned invalid schema: ${result.error.message}`,
      'QA_REVIEW_INVALID_SCHEMA',
    );
  }

  return result.data;
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
