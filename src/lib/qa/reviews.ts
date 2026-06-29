import { resolveAccountInput } from '../accounts/resolve-account-input.js';
import { prisma } from '../db/prisma.js';
import { query } from '../db/client.js';
import { NotFoundError } from '../errors.js';
import {
  qaFindingSchema,
  type QaFinding,
  type ReviewTranscriptOutput,
} from '../../skills/qa/review-transcript.js';

const DEFAULT_QA_HISTORY_LIMIT = 10;
const MAX_QA_HISTORY_LIMIT = 25;

export interface QaReviewRecord {
  id: string;
  jobId: string | null;
  accountId: string;
  accountName: string;
  callId: string | null;
  reviewTrigger: string;
  score: number;
  pass: boolean;
  callType: string;
  summary: string;
  findings: QaFinding[];
  modelUsed: string;
  escalated: boolean;
  transcriptChars: number;
  reviewedAt: string;
}

interface QaReviewRow {
  id: string;
  job_id: string | null;
  account_id: string;
  account_name: string;
  call_id: string | null;
  review_trigger: string;
  score: number;
  pass: boolean;
  call_type: string;
  summary: string;
  findings: unknown;
  model_used: string;
  escalated: boolean;
  transcript_chars: number;
  reviewed_at: Date | string;
}

export interface PersistQaReviewInput {
  jobId: string;
  output: ReviewTranscriptOutput;
  reviewTrigger?: string;
  escalated?: boolean;
}

export async function persistQaReview(input: PersistQaReviewInput): Promise<QaReviewRecord> {
  const reviewTrigger = input.reviewTrigger ?? input.output.reviewTrigger ?? 'manual';
  const { rows } = await query<QaReviewRow>(
    `INSERT INTO qa_reviews (
       job_id,
       account_id,
       call_id,
       review_trigger,
       score,
       pass,
       call_type,
       summary,
       findings,
       model_used,
       escalated,
       transcript_chars,
       reviewed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (call_id) WHERE call_id IS NOT NULL DO UPDATE SET
       job_id = EXCLUDED.job_id,
       account_id = EXCLUDED.account_id,
       review_trigger = EXCLUDED.review_trigger,
       score = EXCLUDED.score,
       pass = EXCLUDED.pass,
       call_type = EXCLUDED.call_type,
       summary = EXCLUDED.summary,
       findings = EXCLUDED.findings,
       model_used = EXCLUDED.model_used,
       escalated = EXCLUDED.escalated,
       transcript_chars = EXCLUDED.transcript_chars,
       reviewed_at = EXCLUDED.reviewed_at
     RETURNING
       qa_reviews.*,
       (SELECT name FROM accounts WHERE accounts.id = qa_reviews.account_id) AS account_name`,
    [
      input.jobId,
      input.output.accountId,
      input.output.callId ?? null,
      reviewTrigger,
      input.output.score,
      input.output.pass,
      input.output.callType,
      input.output.summary,
      JSON.stringify(input.output.findings),
      input.output.modelUsed,
      input.escalated ?? false,
      input.output.transcriptChars,
      input.output.reviewedAt,
    ],
  );

  return mapQaReviewRow(rows[0]);
}

export interface ListQaReviewsInput {
  accountId?: string;
  accountQuery?: string;
  limit?: number;
  failingOnly?: boolean;
}

export interface ListQaReviewsOutput {
  accountId: string;
  accountName: string;
  limit: number;
  failingOnly: boolean;
  reviews: QaReviewRecord[];
}

export async function listQaReviewsForAccount(
  input: ListQaReviewsInput,
): Promise<ListQaReviewsOutput> {
  const account = await resolveAccountInput(input);
  const limit = normalizeQaHistoryLimit(input.limit);

  const rows = await prisma.qa_reviews.findMany({
    where: {
      account_id: account.id,
      ...(input.failingOnly ? { pass: false } : {}),
    },
    include: { accounts: { select: { name: true } } },
    orderBy: { reviewed_at: 'desc' },
    take: limit,
  });

  return {
    accountId: account.id,
    accountName: account.name,
    limit,
    failingOnly: input.failingOnly === true,
    reviews: rows.map((row) =>
      mapQaReviewRow({
        ...row,
        account_name: row.accounts.name,
      }),
    ),
  };
}

export async function getQaReviewByCallId(callId: string): Promise<QaReviewRecord> {
  const row = await prisma.qa_reviews.findFirst({
    where: { call_id: callId.trim() },
    include: { accounts: { select: { name: true } } },
  });

  if (!row) {
    throw new NotFoundError(`No QA review found for call ID "${callId}"`);
  }

  return mapQaReviewRow({
    ...row,
    account_name: row.accounts.name,
  });
}

export function normalizeQaHistoryLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_QA_HISTORY_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_QA_HISTORY_LIMIT);
}

function mapQaReviewRow(row: QaReviewRow | undefined): QaReviewRecord {
  if (!row) {
    throw new NotFoundError('QA review was not found');
  }

  return {
    id: row.id,
    jobId: row.job_id,
    accountId: row.account_id,
    accountName: row.account_name,
    callId: row.call_id,
    reviewTrigger: row.review_trigger,
    score: row.score,
    pass: row.pass,
    callType: row.call_type,
    summary: row.summary,
    findings: parseFindings(row.findings),
    modelUsed: row.model_used,
    escalated: row.escalated,
    transcriptChars: row.transcript_chars,
    reviewedAt:
      row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
  };
}

function parseFindings(findings: unknown): QaFinding[] {
  let parsed: unknown;
  try {
    parsed = typeof findings === 'string' ? JSON.parse(findings) : findings;
  } catch {
    return [];
  }
  const result = qaFindingSchema.array().safeParse(parsed);
  return result.success ? result.data : [];
}