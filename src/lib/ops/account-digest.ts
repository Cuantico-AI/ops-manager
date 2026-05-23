import { resolveAccountInput } from '../accounts/resolve-account-input.js';
import { query } from '../db/client.js';
import { normalizeOpsFleetDigestHours, normalizeOpsFleetDigestLimit } from './fleet-digest.js';

export interface FetchOpsAccountDigestInput {
  accountId?: string;
  accountQuery?: string;
  sinceHours?: number;
  limit?: number;
}

export interface OpsAccountDigestQaFailure {
  id: string;
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

export interface OpsAccountDigestQaTrigger {
  reviewTrigger: string;
  totalReviews: number;
  failedReviews: number;
}

export interface OpsAccountDigestQaSummary {
  totalReviews: number;
  passedReviews: number;
  failedReviews: number;
  escalatedReviews: number;
  averageScore: number | null;
  passRate: number;
  failures: OpsAccountDigestQaFailure[];
  topTriggers: OpsAccountDigestQaTrigger[];
}

export interface OpsAccountDigestClientCheckinAttention {
  id: string;
  status: 'watch' | 'at_risk';
  summary: string;
  openIssueCount: number;
  followUpQuestionCount: number;
  modelUsed: string;
  generatedAt: string;
}

export interface OpsAccountDigestClientCheckinIssueSystem {
  system: string;
  issueCount: number;
}

export interface OpsAccountDigestClientCheckinSummary {
  totalBriefs: number;
  healthyBriefs: number;
  watchBriefs: number;
  atRiskBriefs: number;
  attentionBriefs: number;
  attentionRate: number;
  recentAttention: OpsAccountDigestClientCheckinAttention[];
  topIssueSystems: OpsAccountDigestClientCheckinIssueSystem[];
}

export interface OpsAccountDigestPromptOpsAttention {
  id: string;
  riskLevel: 'low' | 'medium' | 'high';
  blocked: boolean;
  summary: string;
  recommendedChangeCount: number;
  testPlanCount: number;
  blockerCount: number;
  modelUsed: string;
  reviewedAt: string;
}

export interface OpsAccountDigestPromptOpsRisk {
  riskLevel: 'low' | 'medium' | 'high';
  totalReviews: number;
  blockedReviews: number;
}

export interface OpsAccountDigestPromptOpsSummary {
  totalReviews: number;
  lowRiskReviews: number;
  mediumRiskReviews: number;
  highRiskReviews: number;
  blockedReviews: number;
  attentionReviews: number;
  attentionRate: number;
  recentAttention: OpsAccountDigestPromptOpsAttention[];
  riskBreakdown: OpsAccountDigestPromptOpsRisk[];
}

export interface OpsAccountDigestSummary {
  accountId: string;
  accountName: string;
  sinceHours: number;
  since: string;
  generatedAt: string;
  limit: number;
  qa: OpsAccountDigestQaSummary;
  clientCheckin: OpsAccountDigestClientCheckinSummary;
  promptOps: OpsAccountDigestPromptOpsSummary;
  signalCategories: number;
  totalAttentionSignals: number;
  latestSignalAt: string | null;
}

interface QaSummaryRow {
  total_reviews: number | string;
  passed_reviews: number | string;
  failed_reviews: number | string;
  escalated_reviews: number | string;
  average_score: number | string | null;
}

interface QaFailureRow {
  id: string;
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

interface QaTriggerRow {
  review_trigger: string;
  total_reviews: number | string;
  failed_reviews: number | string;
}

interface ClientCheckinSummaryRow {
  total_briefs: number | string;
  healthy_briefs: number | string;
  watch_briefs: number | string;
  at_risk_briefs: number | string;
}

interface ClientCheckinAttentionRow {
  id: string;
  status: 'watch' | 'at_risk';
  summary: string;
  open_issue_count: number | string;
  follow_up_question_count: number | string;
  model_used: string;
  generated_at: Date | string;
}

interface ClientCheckinIssueSystemRow {
  system: string;
  issue_count: number | string;
}

interface PromptOpsSummaryRow {
  total_reviews: number | string;
  low_risk_reviews: number | string;
  medium_risk_reviews: number | string;
  high_risk_reviews: number | string;
  blocked_reviews: number | string;
  attention_reviews: number | string;
}

interface PromptOpsAttentionRow {
  id: string;
  risk_level: 'low' | 'medium' | 'high';
  blocked: boolean;
  summary: string;
  recommended_change_count: number | string;
  test_plan_count: number | string;
  blocker_count: number | string;
  model_used: string;
  reviewed_at: Date | string;
}

interface PromptOpsRiskRow {
  risk_level: 'low' | 'medium' | 'high';
  total_reviews: number | string;
  blocked_reviews: number | string;
}

export async function fetchOpsAccountDigest(
  input: FetchOpsAccountDigestInput,
): Promise<OpsAccountDigestSummary> {
  const account = await resolveAccountInput(input);
  const sinceHours = normalizeOpsFleetDigestHours(input.sinceHours);
  const limit = normalizeOpsFleetDigestLimit(input.limit);
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const [qa, clientCheckin, promptOps] = await Promise.all([
    fetchQaSection(account.id, since, limit),
    fetchClientCheckinSection(account.id, since, limit),
    fetchPromptOpsSection(account.id, since, limit),
  ]);
  const totalAttentionSignals =
    qa.failedReviews + clientCheckin.attentionBriefs + promptOps.attentionReviews;
  const latestSignalAt = latestIso(
    [
      ...qa.failures.map((failure) => failure.reviewedAt),
      ...clientCheckin.recentAttention.map((brief) => brief.generatedAt),
      ...promptOps.recentAttention.map((review) => review.reviewedAt),
    ],
    null,
  );

  return {
    accountId: account.id,
    accountName: account.name,
    sinceHours,
    since,
    generatedAt,
    limit,
    qa,
    clientCheckin,
    promptOps,
    signalCategories: countPositive([
      qa.failedReviews,
      clientCheckin.attentionBriefs,
      promptOps.attentionReviews,
    ]),
    totalAttentionSignals,
    latestSignalAt,
  };
}

async function fetchQaSection(
  accountId: string,
  since: string,
  limit: number,
): Promise<OpsAccountDigestQaSummary> {
  const [summaryResult, failuresResult, triggersResult] = await Promise.all([
    query<QaSummaryRow>(
      `SELECT
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE pass = TRUE)::INT AS passed_reviews,
         COUNT(*) FILTER (WHERE pass = FALSE)::INT AS failed_reviews,
         COUNT(*) FILTER (WHERE escalated = TRUE)::INT AS escalated_reviews,
         ROUND(AVG(score))::INT AS average_score
       FROM qa_reviews
       WHERE account_id = $1
         AND reviewed_at >= $2`,
      [accountId, since],
    ),
    query<QaFailureRow>(
      `SELECT
         qr.id,
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
       WHERE qr.account_id = $1
         AND qr.reviewed_at >= $2
         AND qr.pass = FALSE
       ORDER BY qr.reviewed_at DESC
       LIMIT $3`,
      [accountId, since, limit],
    ),
    query<QaTriggerRow>(
      `SELECT
         review_trigger,
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE pass = FALSE)::INT AS failed_reviews
       FROM qa_reviews
       WHERE account_id = $1
         AND reviewed_at >= $2
       GROUP BY review_trigger
       HAVING COUNT(*) FILTER (WHERE pass = FALSE) > 0
       ORDER BY failed_reviews DESC, total_reviews DESC, review_trigger ASC
       LIMIT $3`,
      [accountId, since, limit],
    ),
  ]);
  const summary = summaryResult.rows[0] ?? {
    total_reviews: 0,
    passed_reviews: 0,
    failed_reviews: 0,
    escalated_reviews: 0,
    average_score: null,
  };
  const totalReviews = toNumber(summary.total_reviews);
  const passedReviews = toNumber(summary.passed_reviews);

  return {
    totalReviews,
    passedReviews,
    failedReviews: toNumber(summary.failed_reviews),
    escalatedReviews: toNumber(summary.escalated_reviews),
    averageScore: summary.average_score === null ? null : toNumber(summary.average_score),
    passRate: totalReviews === 0 ? 0 : roundToOneDecimal((passedReviews / totalReviews) * 100),
    failures: failuresResult.rows.map(mapQaFailureRow),
    topTriggers: triggersResult.rows.map(mapQaTriggerRow),
  };
}

async function fetchClientCheckinSection(
  accountId: string,
  since: string,
  limit: number,
): Promise<OpsAccountDigestClientCheckinSummary> {
  const [summaryResult, attentionResult, systemsResult] = await Promise.all([
    query<ClientCheckinSummaryRow>(
      `SELECT
         COUNT(*)::INT AS total_briefs,
         COUNT(*) FILTER (WHERE status = 'healthy')::INT AS healthy_briefs,
         COUNT(*) FILTER (WHERE status = 'watch')::INT AS watch_briefs,
         COUNT(*) FILTER (WHERE status = 'at_risk')::INT AS at_risk_briefs
       FROM client_checkin_briefs
       WHERE account_id = $1
         AND generated_at >= $2`,
      [accountId, since],
    ),
    query<ClientCheckinAttentionRow>(
      `SELECT
         ccb.id,
         ccb.status,
         ccb.summary,
         jsonb_array_length(ccb.open_issues) AS open_issue_count,
         jsonb_array_length(ccb.follow_up_questions) AS follow_up_question_count,
         ccb.model_used,
         ccb.generated_at
       FROM client_checkin_briefs ccb
       WHERE ccb.account_id = $1
         AND ccb.generated_at >= $2
         AND ccb.status IN ('watch', 'at_risk')
       ORDER BY ccb.generated_at DESC
       LIMIT $3`,
      [accountId, since, limit],
    ),
    query<ClientCheckinIssueSystemRow>(
      `SELECT
         issue->>'system' AS system,
         COUNT(*)::INT AS issue_count
       FROM client_checkin_briefs ccb
       CROSS JOIN LATERAL jsonb_array_elements(ccb.open_issues) AS issue
       WHERE ccb.account_id = $1
         AND ccb.generated_at >= $2
         AND ccb.status IN ('watch', 'at_risk')
         AND issue ? 'system'
       GROUP BY issue->>'system'
       ORDER BY issue_count DESC, system ASC
       LIMIT $3`,
      [accountId, since, limit],
    ),
  ]);
  const summary = summaryResult.rows[0] ?? {
    total_briefs: 0,
    healthy_briefs: 0,
    watch_briefs: 0,
    at_risk_briefs: 0,
  };
  const totalBriefs = toNumber(summary.total_briefs);
  const watchBriefs = toNumber(summary.watch_briefs);
  const atRiskBriefs = toNumber(summary.at_risk_briefs);
  const attentionBriefs = watchBriefs + atRiskBriefs;

  return {
    totalBriefs,
    healthyBriefs: toNumber(summary.healthy_briefs),
    watchBriefs,
    atRiskBriefs,
    attentionBriefs,
    attentionRate: totalBriefs === 0 ? 0 : roundToOneDecimal((attentionBriefs / totalBriefs) * 100),
    recentAttention: attentionResult.rows.map(mapClientCheckinAttentionRow),
    topIssueSystems: systemsResult.rows.map(mapClientCheckinIssueSystemRow),
  };
}

async function fetchPromptOpsSection(
  accountId: string,
  since: string,
  limit: number,
): Promise<OpsAccountDigestPromptOpsSummary> {
  const [summaryResult, attentionResult, riskResult] = await Promise.all([
    query<PromptOpsSummaryRow>(
      `SELECT
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE risk_level = 'low')::INT AS low_risk_reviews,
         COUNT(*) FILTER (WHERE risk_level = 'medium')::INT AS medium_risk_reviews,
         COUNT(*) FILTER (WHERE risk_level = 'high')::INT AS high_risk_reviews,
         COUNT(*) FILTER (WHERE blocked = TRUE)::INT AS blocked_reviews,
         COUNT(*) FILTER (WHERE blocked = TRUE OR risk_level = 'high')::INT AS attention_reviews
       FROM prompt_ops_reviews
       WHERE account_id = $1
         AND reviewed_at >= $2`,
      [accountId, since],
    ),
    query<PromptOpsAttentionRow>(
      `SELECT
         por.id,
         por.risk_level,
         por.blocked,
         por.summary,
         jsonb_array_length(por.recommended_changes) AS recommended_change_count,
         jsonb_array_length(por.test_plan) AS test_plan_count,
         jsonb_array_length(por.blockers) AS blocker_count,
         por.model_used,
         por.reviewed_at
       FROM prompt_ops_reviews por
       WHERE por.account_id = $1
         AND por.reviewed_at >= $2
         AND (por.blocked = TRUE OR por.risk_level = 'high')
       ORDER BY por.reviewed_at DESC
       LIMIT $3`,
      [accountId, since, limit],
    ),
    query<PromptOpsRiskRow>(
      `SELECT
         risk_level,
         COUNT(*)::INT AS total_reviews,
         COUNT(*) FILTER (WHERE blocked = TRUE)::INT AS blocked_reviews
       FROM prompt_ops_reviews
       WHERE account_id = $1
         AND reviewed_at >= $2
       GROUP BY risk_level
       ORDER BY
         CASE risk_level
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           ELSE 3
         END`,
      [accountId, since],
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
    totalReviews,
    lowRiskReviews: toNumber(summary.low_risk_reviews),
    mediumRiskReviews: toNumber(summary.medium_risk_reviews),
    highRiskReviews: toNumber(summary.high_risk_reviews),
    blockedReviews: toNumber(summary.blocked_reviews),
    attentionReviews,
    attentionRate:
      totalReviews === 0 ? 0 : roundToOneDecimal((attentionReviews / totalReviews) * 100),
    recentAttention: attentionResult.rows.map(mapPromptOpsAttentionRow),
    riskBreakdown: riskResult.rows.map(mapPromptOpsRiskRow),
  };
}

function mapQaFailureRow(row: QaFailureRow): OpsAccountDigestQaFailure {
  return {
    id: row.id,
    callId: row.call_id,
    reviewTrigger: row.review_trigger,
    score: toNumber(row.score),
    callType: row.call_type,
    summary: row.summary,
    findingCount: toNumber(row.finding_count),
    modelUsed: row.model_used,
    escalated: row.escalated,
    reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
  };
}

function mapQaTriggerRow(row: QaTriggerRow): OpsAccountDigestQaTrigger {
  return {
    reviewTrigger: row.review_trigger,
    totalReviews: toNumber(row.total_reviews),
    failedReviews: toNumber(row.failed_reviews),
  };
}

function mapClientCheckinAttentionRow(
  row: ClientCheckinAttentionRow,
): OpsAccountDigestClientCheckinAttention {
  return {
    id: row.id,
    status: row.status,
    summary: row.summary,
    openIssueCount: toNumber(row.open_issue_count),
    followUpQuestionCount: toNumber(row.follow_up_question_count),
    modelUsed: row.model_used,
    generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,
  };
}

function mapClientCheckinIssueSystemRow(
  row: ClientCheckinIssueSystemRow,
): OpsAccountDigestClientCheckinIssueSystem {
  return {
    system: row.system,
    issueCount: toNumber(row.issue_count),
  };
}

function mapPromptOpsAttentionRow(row: PromptOpsAttentionRow): OpsAccountDigestPromptOpsAttention {
  return {
    id: row.id,
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

function mapPromptOpsRiskRow(row: PromptOpsRiskRow): OpsAccountDigestPromptOpsRisk {
  return {
    riskLevel: row.risk_level,
    totalReviews: toNumber(row.total_reviews),
    blockedReviews: toNumber(row.blocked_reviews),
  };
}

function countPositive(values: number[]): number {
  return values.filter((value) => value > 0).length;
}

function latestIso(values: string[], fallback: string | null): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!latest) {
      return value;
    }
    return Date.parse(value) > Date.parse(latest) ? value : latest;
  }, fallback);
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
