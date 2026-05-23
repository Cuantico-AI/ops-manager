import { query } from '../db/client.js';

const DEFAULT_PROMPT_OPS_FLEET_SUMMARY_HOURS = 168;
const MAX_PROMPT_OPS_FLEET_SUMMARY_HOURS = 720;
const DEFAULT_PROMPT_OPS_FLEET_LIMIT = 10;
const MAX_PROMPT_OPS_FLEET_LIMIT = 25;
const TOP_PROMPT_OPS_GROUP_LIMIT = 8;

export interface FetchPromptOpsFleetSummaryInput {
  sinceHours?: number;
  limit?: number;
}

export interface PromptOpsFleetAttentionRecord {
  id: string;
  accountId: string;
  accountName: string;
  riskLevel: 'low' | 'medium' | 'high';
  blocked: boolean;
  summary: string;
  recommendedChangeCount: number;
  testPlanCount: number;
  blockerCount: number;
  modelUsed: string;
  reviewedAt: string;
}

export interface PromptOpsFleetAccountSummary {
  accountId: string;
  accountName: string;
  totalReviews: number;
  attentionReviews: number;
  blockedReviews: number;
  highRiskReviews: number;
  latestRiskLevel: 'low' | 'medium' | 'high';
  latestBlocked: boolean;
  latestReviewedAt: string;
}

export interface PromptOpsFleetRiskSummary {
  riskLevel: 'low' | 'medium' | 'high';
  totalReviews: number;
  blockedReviews: number;
}

export interface PromptOpsFleetSummary {
  sinceHours: number;
  since: string;
  generatedAt: string;
  limit: number;
  totalReviews: number;
  lowRiskReviews: number;
  mediumRiskReviews: number;
  highRiskReviews: number;
  blockedReviews: number;
  attentionReviews: number;
  attentionRate: number;
  recentAttention: PromptOpsFleetAttentionRecord[];
  topAccounts: PromptOpsFleetAccountSummary[];
  riskBreakdown: PromptOpsFleetRiskSummary[];
}

interface PromptOpsFleetSummaryRow {
  total_reviews: number | string;
  low_risk_reviews: number | string;
  medium_risk_reviews: number | string;
  high_risk_reviews: number | string;
  blocked_reviews: number | string;
  attention_reviews: number | string;
}

interface PromptOpsFleetAttentionRow {
  id: string;
  account_id: string;
  account_name: string;
  risk_level: 'low' | 'medium' | 'high';
  blocked: boolean;
  summary: string;
  recommended_change_count: number | string;
  test_plan_count: number | string;
  blocker_count: number | string;
  model_used: string;
  reviewed_at: Date | string;
}

interface PromptOpsFleetAccountSummaryRow {
  account_id: string;
  account_name: string;
  total_reviews: number | string;
  attention_reviews: number | string;
  blocked_reviews: number | string;
  high_risk_reviews: number | string;
  latest_risk_level: 'low' | 'medium' | 'high';
  latest_blocked: boolean;
  latest_reviewed_at: Date | string;
}

interface PromptOpsFleetRiskSummaryRow {
  risk_level: 'low' | 'medium' | 'high';
  total_reviews: number | string;
  blocked_reviews: number | string;
}

export async function fetchPromptOpsFleetSummary(
  input: FetchPromptOpsFleetSummaryInput = {},
): Promise<PromptOpsFleetSummary> {
  const sinceHours = normalizePromptOpsFleetSummaryHours(input.sinceHours);
  const limit = normalizePromptOpsFleetLimit(input.limit);
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const [summaryResult, attentionResult, accountsResult, riskResult] = await Promise.all([
    query<PromptOpsFleetSummaryRow>(
      `SELECT
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE risk_level = 'low')::INT AS low_risk_reviews,
         COUNT(*) FILTER (WHERE risk_level = 'medium')::INT AS medium_risk_reviews,
         COUNT(*) FILTER (WHERE risk_level = 'high')::INT AS high_risk_reviews,
         COUNT(*) FILTER (WHERE blocked = TRUE)::INT AS blocked_reviews,
         COUNT(*) FILTER (WHERE blocked = TRUE OR risk_level = 'high')::INT AS attention_reviews
       FROM prompt_ops_reviews
       WHERE reviewed_at >= $1`,
      [since],
    ),
    query<PromptOpsFleetAttentionRow>(
      `SELECT
         por.id,
         por.account_id,
         a.name AS account_name,
         por.risk_level,
         por.blocked,
         por.summary,
         jsonb_array_length(por.recommended_changes) AS recommended_change_count,
         jsonb_array_length(por.test_plan) AS test_plan_count,
         jsonb_array_length(por.blockers) AS blocker_count,
         por.model_used,
         por.reviewed_at
       FROM prompt_ops_reviews por
       JOIN accounts a ON a.id = por.account_id
       WHERE por.reviewed_at >= $1
         AND (por.blocked = TRUE OR por.risk_level = 'high')
       ORDER BY por.reviewed_at DESC
       LIMIT $2`,
      [since, limit],
    ),
    query<PromptOpsFleetAccountSummaryRow>(
      `WITH recent AS (
         SELECT por.*
         FROM prompt_ops_reviews por
         WHERE por.reviewed_at >= $1
       ),
       account_counts AS (
         SELECT
           account_id,
           COUNT(*)::INT AS total_reviews,
           COUNT(*) FILTER (WHERE blocked = TRUE OR risk_level = 'high')::INT AS attention_reviews,
           COUNT(*) FILTER (WHERE blocked = TRUE)::INT AS blocked_reviews,
           COUNT(*) FILTER (WHERE risk_level = 'high')::INT AS high_risk_reviews
         FROM recent
         GROUP BY account_id
       ),
       latest AS (
         SELECT DISTINCT ON (account_id)
           account_id,
           risk_level AS latest_risk_level,
           blocked AS latest_blocked,
           reviewed_at AS latest_reviewed_at
         FROM recent
         ORDER BY account_id, reviewed_at DESC
       )
       SELECT
         a.id AS account_id,
         a.name AS account_name,
         ac.total_reviews,
         ac.attention_reviews,
         ac.blocked_reviews,
         ac.high_risk_reviews,
         latest.latest_risk_level,
         latest.latest_blocked,
         latest.latest_reviewed_at
       FROM account_counts ac
       JOIN latest ON latest.account_id = ac.account_id
       JOIN accounts a ON a.id = ac.account_id
       WHERE ac.attention_reviews > 0
       ORDER BY ac.attention_reviews DESC, ac.blocked_reviews DESC, ac.high_risk_reviews DESC, ac.total_reviews DESC, a.name ASC
       LIMIT $2`,
      [since, TOP_PROMPT_OPS_GROUP_LIMIT],
    ),
    query<PromptOpsFleetRiskSummaryRow>(
      `SELECT
         risk_level,
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE blocked = TRUE)::INT AS blocked_reviews
       FROM prompt_ops_reviews
       WHERE reviewed_at >= $1
       GROUP BY risk_level
       ORDER BY
         CASE risk_level
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           ELSE 3
         END`,
      [since],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    total_reviews: 0,
    low_risk_reviews: 0,
    medium_risk_reviews: 0,
    high_risk_reviews: 0,
    blocked_reviews: 0,
    attention_reviews: 0,
  };
  const totalReviews = toNumber(summary.total_reviews);
  const attentionReviews = toNumber(summary.attention_reviews);

  return {
    sinceHours,
    since,
    generatedAt,
    limit,
    totalReviews,
    lowRiskReviews: toNumber(summary.low_risk_reviews),
    mediumRiskReviews: toNumber(summary.medium_risk_reviews),
    highRiskReviews: toNumber(summary.high_risk_reviews),
    blockedReviews: toNumber(summary.blocked_reviews),
    attentionReviews,
    attentionRate:
      totalReviews === 0 ? 0 : roundToOneDecimal((attentionReviews / totalReviews) * 100),
    recentAttention: attentionResult.rows.map(mapPromptOpsFleetAttentionRow),
    topAccounts: accountsResult.rows.map(mapPromptOpsFleetAccountSummaryRow),
    riskBreakdown: riskResult.rows.map(mapPromptOpsFleetRiskSummaryRow),
  };
}

export function normalizePromptOpsFleetSummaryHours(hours: number | undefined): number {
  if (!hours) {
    return DEFAULT_PROMPT_OPS_FLEET_SUMMARY_HOURS;
  }

  return Math.min(Math.max(Math.trunc(hours), 1), MAX_PROMPT_OPS_FLEET_SUMMARY_HOURS);
}

export function normalizePromptOpsFleetLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_PROMPT_OPS_FLEET_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PROMPT_OPS_FLEET_LIMIT);
}

function mapPromptOpsFleetAttentionRow(
  row: PromptOpsFleetAttentionRow,
): PromptOpsFleetAttentionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    riskLevel: row.risk_level,
    blocked: row.blocked,
    summary: row.summary,
    recommendedChangeCount: toNumber(row.recommended_change_count),
    testPlanCount: toNumber(row.test_plan_count),
    blockerCount: toNumber(row.blocker_count),
    modelUsed: row.model_used,
    reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
  };
}

function mapPromptOpsFleetAccountSummaryRow(
  row: PromptOpsFleetAccountSummaryRow,
): PromptOpsFleetAccountSummary {
  return {
    accountId: row.account_id,
    accountName: row.account_name,
    totalReviews: toNumber(row.total_reviews),
    attentionReviews: toNumber(row.attention_reviews),
    blockedReviews: toNumber(row.blocked_reviews),
    highRiskReviews: toNumber(row.high_risk_reviews),
    latestRiskLevel: row.latest_risk_level,
    latestBlocked: row.latest_blocked,
    latestReviewedAt:
      row.latest_reviewed_at instanceof Date
        ? row.latest_reviewed_at.toISOString()
        : row.latest_reviewed_at,
  };
}

function mapPromptOpsFleetRiskSummaryRow(
  row: PromptOpsFleetRiskSummaryRow,
): PromptOpsFleetRiskSummary {
  return {
    riskLevel: row.risk_level,
    totalReviews: toNumber(row.total_reviews),
    blockedReviews: toNumber(row.blocked_reviews),
  };
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
