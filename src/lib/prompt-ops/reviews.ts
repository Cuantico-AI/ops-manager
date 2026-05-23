import { z } from 'zod';
import { resolveAccountInput } from '../accounts/resolve-account-input.js';
import { query } from '../db/client.js';
import { NotFoundError } from '../errors.js';
import {
  promptOpsReviewSchema,
  type PromptOpsReview,
  type ReviewPromptOpsRequestOutput,
} from '../../skills/prompt-ops/review-request.js';

const DEFAULT_PROMPT_OPS_HISTORY_LIMIT = 10;
const MAX_PROMPT_OPS_HISTORY_LIMIT = 25;

export interface PromptOpsReviewRecord extends PromptOpsReview {
  id: string;
  jobId: string | null;
  accountId: string;
  accountName: string;
  modelUsed: string;
  requestChars: number;
  currentPromptChars: number;
  conversationSampleChars: number;
  reviewedAt: string;
  createdAt: string;
}

interface PromptOpsReviewRow {
  id: string;
  job_id: string | null;
  account_id: string;
  account_name: string;
  risk_level: 'low' | 'medium' | 'high';
  blocked: boolean;
  summary: string;
  intended_outcome: string;
  recommended_changes: unknown;
  test_plan: unknown;
  rollback_plan: unknown;
  clarifying_questions: unknown;
  blockers: unknown;
  model_used: string;
  request_chars: number;
  current_prompt_chars: number;
  conversation_sample_chars: number;
  reviewed_at: Date | string;
  created_at: Date | string;
}

export interface PersistPromptOpsReviewInput {
  jobId: string;
  output: ReviewPromptOpsRequestOutput;
}

export async function persistPromptOpsReview(
  input: PersistPromptOpsReviewInput,
): Promise<PromptOpsReviewRecord> {
  const { rows } = await query<PromptOpsReviewRow>(
    `INSERT INTO prompt_ops_reviews (
       job_id,
       account_id,
       risk_level,
       blocked,
       summary,
       intended_outcome,
       recommended_changes,
       test_plan,
       rollback_plan,
       clarifying_questions,
       blockers,
       model_used,
       request_chars,
       current_prompt_chars,
       conversation_sample_chars,
       reviewed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING
       prompt_ops_reviews.*,
       (SELECT name FROM accounts WHERE accounts.id = prompt_ops_reviews.account_id) AS account_name`,
    [
      input.jobId,
      input.output.accountId,
      input.output.riskLevel,
      input.output.blocked,
      input.output.summary,
      input.output.intendedOutcome,
      JSON.stringify(input.output.recommendedChanges),
      JSON.stringify(input.output.testPlan),
      JSON.stringify(input.output.rollbackPlan),
      JSON.stringify(input.output.clarifyingQuestions),
      JSON.stringify(input.output.blockers),
      input.output.modelUsed,
      input.output.requestChars,
      input.output.currentPromptChars,
      input.output.conversationSampleChars,
      input.output.reviewedAt,
    ],
  );

  return mapPromptOpsReviewRow(rows[0]);
}

export interface ListPromptOpsReviewsInput {
  accountId?: string;
  accountQuery?: string;
  limit?: number;
  blockedOnly?: boolean;
}

export interface ListPromptOpsReviewsOutput {
  accountId: string;
  accountName: string;
  limit: number;
  blockedOnly: boolean;
  reviews: PromptOpsReviewRecord[];
}

export async function listPromptOpsReviewsForAccount(
  input: ListPromptOpsReviewsInput,
): Promise<ListPromptOpsReviewsOutput> {
  const account = await resolveAccountInput(input);
  const limit = normalizePromptOpsHistoryLimit(input.limit);
  const clauses = ['por.account_id = $1'];
  const params: unknown[] = [account.id, limit];

  if (input.blockedOnly) {
    clauses.push('por.blocked = TRUE');
  }

  const { rows } = await query<PromptOpsReviewRow>(
    `SELECT por.*, a.name AS account_name
     FROM prompt_ops_reviews por
     JOIN accounts a ON a.id = por.account_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY por.reviewed_at DESC
     LIMIT $2`,
    params,
  );

  return {
    accountId: account.id,
    accountName: account.name,
    limit,
    blockedOnly: input.blockedOnly === true,
    reviews: rows.map(mapPromptOpsReviewRow),
  };
}

export async function getPromptOpsReviewById(id: string): Promise<PromptOpsReviewRecord> {
  const { rows } = await query<PromptOpsReviewRow>(
    `SELECT por.*, a.name AS account_name
     FROM prompt_ops_reviews por
     JOIN accounts a ON a.id = por.account_id
     WHERE por.id = $1
     LIMIT 1`,
    [id.trim()],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`No Prompt Ops review found for ID "${id}"`);
  }

  return mapPromptOpsReviewRow(row);
}

export function normalizePromptOpsHistoryLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_PROMPT_OPS_HISTORY_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PROMPT_OPS_HISTORY_LIMIT);
}

function mapPromptOpsReviewRow(row: PromptOpsReviewRow | undefined): PromptOpsReviewRecord {
  if (!row) {
    throw new NotFoundError('Prompt Ops review was not found');
  }

  const parsedReview = promptOpsReviewSchema.parse({
    riskLevel: row.risk_level,
    blocked: row.blocked,
    summary: row.summary,
    intendedOutcome: row.intended_outcome,
    recommendedChanges: parseStringArray(row.recommended_changes),
    testPlan: parseStringArray(row.test_plan),
    rollbackPlan: parseStringArray(row.rollback_plan),
    clarifyingQuestions: parseStringArray(row.clarifying_questions),
    blockers: parseStringArray(row.blockers),
  });

  return {
    id: row.id,
    jobId: row.job_id,
    accountId: row.account_id,
    accountName: row.account_name,
    modelUsed: row.model_used,
    requestChars: row.request_chars,
    currentPromptChars: row.current_prompt_chars,
    conversationSampleChars: row.conversation_sample_chars,
    reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    ...parsedReview,
  };
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  const result = z.array(z.string().trim().min(1)).safeParse(parsed);
  return result.success ? result.data : [];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
