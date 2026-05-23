import { query } from '../db/client.js';

const DEFAULT_CLIENT_CHECKIN_FLEET_SUMMARY_HOURS = 168;
const MAX_CLIENT_CHECKIN_FLEET_SUMMARY_HOURS = 720;
const DEFAULT_CLIENT_CHECKIN_FLEET_LIMIT = 10;
const MAX_CLIENT_CHECKIN_FLEET_LIMIT = 25;
const TOP_CLIENT_CHECKIN_GROUP_LIMIT = 8;

export interface FetchClientCheckinFleetSummaryInput {
  sinceHours?: number;
  limit?: number;
}

export interface ClientCheckinFleetAttentionRecord {
  id: string;
  accountId: string;
  accountName: string;
  status: 'watch' | 'at_risk';
  summary: string;
  openIssueCount: number;
  followUpQuestionCount: number;
  modelUsed: string;
  generatedAt: string;
}

export interface ClientCheckinFleetAccountSummary {
  accountId: string;
  accountName: string;
  totalBriefs: number;
  attentionBriefs: number;
  latestStatus: 'healthy' | 'watch' | 'at_risk';
  latestGeneratedAt: string;
}

export interface ClientCheckinFleetIssueSystemSummary {
  system: string;
  issueCount: number;
}

export interface ClientCheckinFleetSummary {
  sinceHours: number;
  since: string;
  generatedAt: string;
  limit: number;
  totalBriefs: number;
  healthyBriefs: number;
  watchBriefs: number;
  atRiskBriefs: number;
  attentionBriefs: number;
  attentionRate: number;
  recentAttention: ClientCheckinFleetAttentionRecord[];
  topAccounts: ClientCheckinFleetAccountSummary[];
  topIssueSystems: ClientCheckinFleetIssueSystemSummary[];
}

interface ClientCheckinFleetSummaryRow {
  total_briefs: number | string;
  healthy_briefs: number | string;
  watch_briefs: number | string;
  at_risk_briefs: number | string;
}

interface ClientCheckinFleetAttentionRow {
  id: string;
  account_id: string;
  account_name: string;
  status: 'watch' | 'at_risk';
  summary: string;
  open_issue_count: number | string;
  follow_up_question_count: number | string;
  model_used: string;
  generated_at: Date | string;
}

interface ClientCheckinFleetAccountSummaryRow {
  account_id: string;
  account_name: string;
  total_briefs: number | string;
  attention_briefs: number | string;
  latest_status: 'healthy' | 'watch' | 'at_risk';
  latest_generated_at: Date | string;
}

interface ClientCheckinFleetIssueSystemSummaryRow {
  system: string;
  issue_count: number | string;
}

export async function fetchClientCheckinFleetSummary(
  input: FetchClientCheckinFleetSummaryInput = {},
): Promise<ClientCheckinFleetSummary> {
  const sinceHours = normalizeClientCheckinFleetSummaryHours(input.sinceHours);
  const limit = normalizeClientCheckinFleetLimit(input.limit);
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const [summaryResult, attentionResult, accountsResult, systemsResult] = await Promise.all([
    query<ClientCheckinFleetSummaryRow>(
      `SELECT
         COUNT(*)::INT AS total_briefs,
         COUNT(*) FILTER (WHERE status = 'healthy')::INT AS healthy_briefs,
         COUNT(*) FILTER (WHERE status = 'watch')::INT AS watch_briefs,
         COUNT(*) FILTER (WHERE status = 'at_risk')::INT AS at_risk_briefs
       FROM client_checkin_briefs
       WHERE generated_at >= $1`,
      [since],
    ),
    query<ClientCheckinFleetAttentionRow>(
      `SELECT
         ccb.id,
         ccb.account_id,
         a.name AS account_name,
         ccb.status,
         ccb.summary,
         jsonb_array_length(ccb.open_issues) AS open_issue_count,
         jsonb_array_length(ccb.follow_up_questions) AS follow_up_question_count,
         ccb.model_used,
         ccb.generated_at
       FROM client_checkin_briefs ccb
       JOIN accounts a ON a.id = ccb.account_id
       WHERE ccb.generated_at >= $1
         AND ccb.status IN ('watch', 'at_risk')
       ORDER BY ccb.generated_at DESC
       LIMIT $2`,
      [since, limit],
    ),
    query<ClientCheckinFleetAccountSummaryRow>(
      `WITH recent AS (
         SELECT ccb.*
         FROM client_checkin_briefs ccb
         WHERE ccb.generated_at >= $1
       ),
       account_counts AS (
         SELECT
           account_id,
           COUNT(*)::INT AS total_briefs,
           COUNT(*) FILTER (WHERE status IN ('watch', 'at_risk'))::INT AS attention_briefs
         FROM recent
         GROUP BY account_id
       ),
       latest AS (
         SELECT DISTINCT ON (account_id)
           account_id,
           status AS latest_status,
           generated_at AS latest_generated_at
         FROM recent
         ORDER BY account_id, generated_at DESC
       )
       SELECT
         a.id AS account_id,
         a.name AS account_name,
         ac.total_briefs,
         ac.attention_briefs,
         latest.latest_status,
         latest.latest_generated_at
       FROM account_counts ac
       JOIN latest ON latest.account_id = ac.account_id
       JOIN accounts a ON a.id = ac.account_id
       WHERE ac.attention_briefs > 0
       ORDER BY ac.attention_briefs DESC, ac.total_briefs DESC, a.name ASC
       LIMIT $2`,
      [since, TOP_CLIENT_CHECKIN_GROUP_LIMIT],
    ),
    query<ClientCheckinFleetIssueSystemSummaryRow>(
      `SELECT
         issue->>'system' AS system,
         COUNT(*)::INT AS issue_count
       FROM client_checkin_briefs ccb
       CROSS JOIN LATERAL jsonb_array_elements(ccb.open_issues) AS issue
       WHERE ccb.generated_at >= $1
         AND ccb.status IN ('watch', 'at_risk')
         AND issue ? 'system'
       GROUP BY issue->>'system'
       ORDER BY issue_count DESC, system ASC
       LIMIT $2`,
      [since, TOP_CLIENT_CHECKIN_GROUP_LIMIT],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    total_briefs: 0,
    healthy_briefs: 0,
    watch_briefs: 0,
    at_risk_briefs: 0,
  };
  const totalBriefs = toNumber(summary.total_briefs);
  const healthyBriefs = toNumber(summary.healthy_briefs);
  const watchBriefs = toNumber(summary.watch_briefs);
  const atRiskBriefs = toNumber(summary.at_risk_briefs);
  const attentionBriefs = watchBriefs + atRiskBriefs;

  return {
    sinceHours,
    since,
    generatedAt,
    limit,
    totalBriefs,
    healthyBriefs,
    watchBriefs,
    atRiskBriefs,
    attentionBriefs,
    attentionRate: totalBriefs === 0 ? 0 : roundToOneDecimal((attentionBriefs / totalBriefs) * 100),
    recentAttention: attentionResult.rows.map(mapClientCheckinFleetAttentionRow),
    topAccounts: accountsResult.rows.map(mapClientCheckinFleetAccountSummaryRow),
    topIssueSystems: systemsResult.rows.map(mapClientCheckinFleetIssueSystemSummaryRow),
  };
}

export function normalizeClientCheckinFleetSummaryHours(hours: number | undefined): number {
  if (!hours) {
    return DEFAULT_CLIENT_CHECKIN_FLEET_SUMMARY_HOURS;
  }

  return Math.min(Math.max(Math.trunc(hours), 1), MAX_CLIENT_CHECKIN_FLEET_SUMMARY_HOURS);
}

export function normalizeClientCheckinFleetLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_CLIENT_CHECKIN_FLEET_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_CLIENT_CHECKIN_FLEET_LIMIT);
}

function mapClientCheckinFleetAttentionRow(
  row: ClientCheckinFleetAttentionRow,
): ClientCheckinFleetAttentionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    status: row.status,
    summary: row.summary,
    openIssueCount: toNumber(row.open_issue_count),
    followUpQuestionCount: toNumber(row.follow_up_question_count),
    modelUsed: row.model_used,
    generatedAt:
      row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,
  };
}

function mapClientCheckinFleetAccountSummaryRow(
  row: ClientCheckinFleetAccountSummaryRow,
): ClientCheckinFleetAccountSummary {
  return {
    accountId: row.account_id,
    accountName: row.account_name,
    totalBriefs: toNumber(row.total_briefs),
    attentionBriefs: toNumber(row.attention_briefs),
    latestStatus: row.latest_status,
    latestGeneratedAt:
      row.latest_generated_at instanceof Date
        ? row.latest_generated_at.toISOString()
        : row.latest_generated_at,
  };
}

function mapClientCheckinFleetIssueSystemSummaryRow(
  row: ClientCheckinFleetIssueSystemSummaryRow,
): ClientCheckinFleetIssueSystemSummary {
  return {
    system: row.system,
    issueCount: toNumber(row.issue_count),
  };
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
