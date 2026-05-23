import { query } from '../db/client.js';

const DEFAULT_QA_FLEET_SUMMARY_HOURS = 24;
const MAX_QA_FLEET_SUMMARY_HOURS = 168;
const DEFAULT_QA_FLEET_FAILURE_LIMIT = 10;
const MAX_QA_FLEET_FAILURE_LIMIT = 25;
const TOP_QA_FLEET_GROUP_LIMIT = 8;

export interface FetchFleetQaSummaryInput {
  sinceHours?: number;
  limit?: number;
}

export interface FleetQaFailureRecord {
  id: string;
  accountId: string;
  accountName: string;
  callId: string | null;
  reviewTrigger: string;
  score: number;
  callType: string;
  summary: string;
  findingCount: number;
  modelUsed: string;
  escalated: boolean;
  reviewedAt: string;
}

export interface FleetQaAccountSummary {
  accountId: string;
  accountName: string;
  totalReviews: number;
  failedReviews: number;
  averageScore: number | null;
}

export interface FleetQaTriggerSummary {
  reviewTrigger: string;
  totalReviews: number;
  failedReviews: number;
}

export interface FleetQaSummary {
  sinceHours: number;
  since: string;
  generatedAt: string;
  limit: number;
  totalReviews: number;
  passedReviews: number;
  failedReviews: number;
  escalatedReviews: number;
  passRate: number;
  failures: FleetQaFailureRecord[];
  topAccounts: FleetQaAccountSummary[];
  topTriggers: FleetQaTriggerSummary[];
}

interface FleetQaSummaryRow {
  total_reviews: number | string;
  passed_reviews: number | string;
  failed_reviews: number | string;
  escalated_reviews: number | string;
}

interface FleetQaFailureRow {
  id: string;
  account_id: string;
  account_name: string;
  call_id: string | null;
  review_trigger: string;
  score: number | string;
  call_type: string;
  summary: string;
  finding_count: number | string;
  model_used: string;
  escalated: boolean;
  reviewed_at: Date | string;
}

interface FleetQaAccountSummaryRow {
  account_id: string;
  account_name: string;
  total_reviews: number | string;
  failed_reviews: number | string;
  average_score: number | string | null;
}

interface FleetQaTriggerSummaryRow {
  review_trigger: string;
  total_reviews: number | string;
  failed_reviews: number | string;
}

export async function fetchFleetQaSummary(
  input: FetchFleetQaSummaryInput = {},
): Promise<FleetQaSummary> {
  const sinceHours = normalizeFleetQaSummaryHours(input.sinceHours);
  const limit = normalizeFleetQaFailureLimit(input.limit);
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const [summaryResult, failuresResult, accountsResult, triggersResult] = await Promise.all([
    query<FleetQaSummaryRow>(
      `SELECT
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE pass = TRUE)::INT AS passed_reviews,
         COUNT(*) FILTER (WHERE pass = FALSE)::INT AS failed_reviews,
         COUNT(*) FILTER (WHERE escalated = TRUE)::INT AS escalated_reviews
       FROM qa_reviews
       WHERE reviewed_at >= $1`,
      [since],
    ),
    query<FleetQaFailureRow>(
      `SELECT
         qr.id,
         qr.account_id,
         a.name AS account_name,
         qr.call_id,
         qr.review_trigger,
         qr.score,
         qr.call_type,
         qr.summary,
         jsonb_array_length(qr.findings) AS finding_count,
         qr.model_used,
         qr.escalated,
         qr.reviewed_at
       FROM qa_reviews qr
       JOIN accounts a ON a.id = qr.account_id
       WHERE qr.reviewed_at >= $1
         AND qr.pass = FALSE
       ORDER BY qr.reviewed_at DESC
       LIMIT $2`,
      [since, limit],
    ),
    query<FleetQaAccountSummaryRow>(
      `SELECT
         a.id AS account_id,
         a.name AS account_name,
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE qr.pass = FALSE)::INT AS failed_reviews,
         ROUND(AVG(qr.score))::INT AS average_score
       FROM qa_reviews qr
       JOIN accounts a ON a.id = qr.account_id
       WHERE qr.reviewed_at >= $1
       GROUP BY a.id, a.name
       HAVING COUNT(*) FILTER (WHERE qr.pass = FALSE) > 0
       ORDER BY failed_reviews DESC, total_reviews DESC, account_name ASC
       LIMIT $2`,
      [since, TOP_QA_FLEET_GROUP_LIMIT],
    ),
    query<FleetQaTriggerSummaryRow>(
      `SELECT
         review_trigger,
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE pass = FALSE)::INT AS failed_reviews
       FROM qa_reviews
       WHERE reviewed_at >= $1
       GROUP BY review_trigger
       HAVING COUNT(*) FILTER (WHERE pass = FALSE) > 0
       ORDER BY failed_reviews DESC, total_reviews DESC, review_trigger ASC
       LIMIT $2`,
      [since, TOP_QA_FLEET_GROUP_LIMIT],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    total_reviews: 0,
    passed_reviews: 0,
    failed_reviews: 0,
    escalated_reviews: 0,
  };
  const totalReviews = toNumber(summary.total_reviews);
  const passedReviews = toNumber(summary.passed_reviews);
  const failedReviews = toNumber(summary.failed_reviews);

  return {
    sinceHours,
    since,
    generatedAt,
    limit,
    totalReviews,
    passedReviews,
    failedReviews,
    escalatedReviews: toNumber(summary.escalated_reviews),
    passRate: totalReviews === 0 ? 0 : roundToOneDecimal((passedReviews / totalReviews) * 100),
    failures: failuresResult.rows.map(mapFleetQaFailureRow),
    topAccounts: accountsResult.rows.map(mapFleetQaAccountSummaryRow),
    topTriggers: triggersResult.rows.map(mapFleetQaTriggerSummaryRow),
  };
}

export function normalizeFleetQaSummaryHours(hours: number | undefined): number {
  if (!hours) {
    return DEFAULT_QA_FLEET_SUMMARY_HOURS;
  }

  return Math.min(Math.max(Math.trunc(hours), 1), MAX_QA_FLEET_SUMMARY_HOURS);
}

export function normalizeFleetQaFailureLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_QA_FLEET_FAILURE_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_QA_FLEET_FAILURE_LIMIT);
}

function mapFleetQaFailureRow(row: FleetQaFailureRow): FleetQaFailureRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    callId: row.call_id,
    reviewTrigger: row.review_trigger,
    score: toNumber(row.score),
    callType: row.call_type,
    summary: row.summary,
    findingCount: toNumber(row.finding_count),
    modelUsed: row.model_used,
    escalated: row.escalated,
    reviewedAt:
      row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
  };
}

function mapFleetQaAccountSummaryRow(row: FleetQaAccountSummaryRow): FleetQaAccountSummary {
  return {
    accountId: row.account_id,
    accountName: row.account_name,
    totalReviews: toNumber(row.total_reviews),
    failedReviews: toNumber(row.failed_reviews),
    averageScore: row.average_score === null ? null : toNumber(row.average_score),
  };
}

function mapFleetQaTriggerSummaryRow(row: FleetQaTriggerSummaryRow): FleetQaTriggerSummary {
  return {
    reviewTrigger: row.review_trigger,
    totalReviews: toNumber(row.total_reviews),
    failedReviews: toNumber(row.failed_reviews),
  };
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
