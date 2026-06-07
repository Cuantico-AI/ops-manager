import type {
  Account,
  AccountDetailResponse,
  Approval,
  ApprovalDecision,
  ApprovalDiff,
  ApprovalsResponse,
  AuditEntry,
  AuditResponse,
  FleetResponse,
  QaCategory,
  QaDecision,
  QaFlag,
  QaFlagsResponse,
  QaHealth,
  QaHealthResponse,
  Request,
  RequestsResponse,
  ResolveApprovalResponse,
  ResolveQaFlagResponse,
  TimelineEvent,
  Trigger,
} from '@cuantico/contracts';
import { qaCategorySchema } from '@cuantico/contracts';
import { query } from '../lib/db/client.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { getApprovalById, resolveApproval as resolveApprovalRecord } from '../lib/approval/store.js';
import type { ReadApiDataSource } from './data-source.js';
import { computeRollup, fmtAgo, qaStatusFor } from './mock-data.js';

const FLEET_TINTS: Array<[string, string]> = [
  ['#5b8cff', '#3b63d6'],
  ['#36c08a', '#1f8a63'],
  ['#f3b13e', '#c8861a'],
  ['#c08cff', '#8a4fd6'],
  ['#f0635f', '#c43e3a'],
  ['#7fd4c0', '#3fa890'],
  ['#ff9d6b', '#d96a3a'],
  ['#6ba8ff', '#3b78d6'],
  ['#e07fb0', '#b8487f'],
  ['#9bd45f', '#6aa82f'],
];

interface AccountRow {
  id: string;
  name: string;
  ghl_location_id: string | null;
  assistable_subaccount_id: string | null;
  n8n_workflow_ids: string[] | null;
  status: string;
  ghl_token_status: string | null;
  assistable_oauth_status: string | null;
  n8n_workflow_status: string | null;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
}

/**
 * Postgres-backed read API. Reads real data where the schema supports it
 * (accounts, approvals, audit_log, qa_reviews, requests). Several dashboard
 * fields are presentation-only and not yet first-class columns (PIT
 * days-to-expiry, Assistable minute cap, per-day activity sparkline); those are
 * derived/synthesized here and called out in comments — they are the
 * "account UI fields" gap from the June review and convert to real columns
 * later without changing the contract.
 *
 * Audit note: `audit_log` is immutable via Postgres role grants (ops_app has
 * INSERT/SELECT only), which is the architecture doc's mandated guarantee. It is
 * not literally hash-chained, so `hash`/`prev` below are display-stable
 * derivations of the row id; the dashboard labels this "append-only ·
 * role-enforced" rather than implying a cryptographic chain.
 */
export class PostgresReadApiDataSource implements ReadApiDataSource {
  readonly label = 'postgres';

  async getFleet(): Promise<FleetResponse> {
    const accounts = await this.loadAccounts();
    const [requests, approvals, flags, health] = await Promise.all([
      this.getRequests().then((r) => r.requests),
      this.getApprovals().then((a) => a.approvals),
      this.getQaFlags().then((f) => f.flags),
      this.getQaHealth().then((h) => h.health),
    ]);

    return {
      accounts,
      rollup: computeRollup(accounts, requests, approvals, flags, health),
      syncedAt: new Date().toISOString(),
    };
  }

  async getAccountDetail(accountId: string): Promise<AccountDetailResponse> {
    const accounts = await this.loadAccounts({ id: accountId });
    const account = accounts[0];
    if (!account) {
      throw new NotFoundError(`Account not found: ${accountId}`);
    }

    const [health, audit, requests] = await Promise.all([
      this.getQaHealth().then((h) => h.health.find((q) => q.acct === account.name) ?? null),
      this.getAudit().then((a) => a.entries.filter((e) => e.acct === account.name).slice(0, 8)),
      this.getRequests().then((r) =>
        r.requests.filter((req) => req.acct === account.name && req.status !== 'done'),
      ),
    ]);

    const timeline: TimelineEvent[] = audit
      .slice(0, 6)
      .map((e) => ({ text: e.action, ts: e.ts, result: e.result }));

    return { account, qa: health, timeline, recentActions: audit, openRequests: requests };
  }

  async getRequests(): Promise<RequestsResponse> {
    const { rows } = await query<{
      id: string;
      title: string;
      status: string;
      channel: string;
      priority: string;
      approval_id: string | null;
      account_name: string | null;
      updated_at: Date | string;
    }>(
      `SELECT r.id, r.title, r.status, r.channel, r.priority, r.approval_id,
              a.name AS account_name, r.updated_at
       FROM requests r
       LEFT JOIN accounts a ON a.id = r.account_id
       ORDER BY r.updated_at DESC
       LIMIT 200`,
    );

    const requests: Request[] = rows.map((row) => ({
      id: row.id,
      acct: row.account_name ?? 'Unassigned',
      title: row.title,
      status: coerceEnum(row.status, REQUEST_STATUSES, 'new'),
      min: minsAgo(row.updated_at),
      chan: coerceEnum(row.channel, CHANNELS, 'human'),
      prio: coerceEnum(row.priority, PRIORITIES, 'med'),
      approvalId: row.approval_id ?? undefined,
    }));

    return { requests };
  }

  async getApprovals(): Promise<ApprovalsResponse> {
    const { rows } = await query<{
      id: string;
      skill: string;
      target_summary: string;
      proposed_action: unknown;
      requested_at: Date | string;
      account_name: string | null;
    }>(
      `SELECT ap.id, ap.skill, ap.target_summary, ap.proposed_action, ap.requested_at,
              a.name AS account_name
       FROM approvals ap
       LEFT JOIN jobs j ON j.id = ap.job_id
       LEFT JOIN accounts a ON a.id = j.account_id
       WHERE ap.status = 'pending' AND ap.expires_at > NOW()
       ORDER BY ap.requested_at DESC
       LIMIT 100`,
    );

    const approvals: Approval[] = rows.map((row) => ({
      id: row.id,
      acct: row.account_name ?? row.target_summary,
      risk: 'med',
      verb: humanizeSkill(row.skill),
      desc: row.target_summary,
      diff: deriveDiff(row.proposed_action),
      trigger: 'system',
      who: row.skill,
      min: minsAgo(row.requested_at),
    }));

    return { approvals };
  }

  async resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
    operator: string,
  ): Promise<ResolveApprovalResponse> {
    const before = await getApprovalById(approvalId);
    await resolveApprovalRecord(approvalId, decision === 'approve' ? 'approved' : 'rejected', operator);

    const accountName = await accountNameForJob(before.jobId);
    await query(
      `UPDATE requests
       SET status = $1, updated_at = NOW()
       WHERE approval_id = $2`,
      [decision === 'approve' ? 'progress' : 'triaging', approvalId],
    );

    const { rows } = await query<{ id: string; title: string; status: string; channel: string; priority: string; account_name: string | null }>(
      `SELECT r.id, r.title, r.status, r.channel, r.priority, a.name AS account_name
       FROM requests r LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.approval_id = $1 LIMIT 1`,
      [approvalId],
    );
    const linked = rows[0];
    const request: Request | null = linked
      ? {
          id: linked.id,
          acct: linked.account_name ?? 'Unassigned',
          title: linked.title,
          status: coerceEnum(linked.status, REQUEST_STATUSES, 'new'),
          min: 0,
          chan: coerceEnum(linked.channel, CHANNELS, 'human'),
          prio: coerceEnum(linked.priority, PRIORITIES, 'med'),
        }
      : null;

    const auditEntry = await this.writeAudit({
      accountName: accountName ?? before.targetSummary,
      action: `${decision === 'approve' ? 'Approved' : 'Rejected'}: ${humanizeSkill(before.skill)}`,
      detail: decision === 'approve' ? before.targetSummary : 'operator declined — no change applied',
      actor: `human:${operator}`,
      mutated: decision === 'approve',
      result: decision === 'approve' ? 'ok' : 'info',
      approvalId,
    });

    return { approvalId, decision, request, auditEntry };
  }

  async getQaFlags(): Promise<QaFlagsResponse> {
    const { rows } = await query<{
      id: string;
      account_name: string;
      score: number | string;
      call_type: string;
      findings: unknown;
      reviewed_at: Date | string;
    }>(
      `SELECT qr.id, a.name AS account_name, qr.score, qr.call_type, qr.findings, qr.reviewed_at
       FROM qa_reviews qr
       JOIN accounts a ON a.id = qr.account_id
       WHERE qr.pass = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM qa_flag_resolutions res WHERE res.qa_review_id = qr.id
         )
       ORDER BY qr.reviewed_at DESC
       LIMIT 50`,
    );

    const flags: QaFlag[] = [];
    for (const row of rows) {
      const findings = parseFindings(row.findings);
      const confidence = clamp(Math.round(100 - Number(row.score)), 0, 100);
      findings.forEach((finding, index) => {
        flags.push({
          id: `${row.id}:${index}`,
          acct: row.account_name,
          channel: row.call_type === 'unknown' ? 'sms' : 'voice',
          severity: mapFindingSeverity(finding.severity),
          confidence,
          category: coerceCategory(finding.category),
          when: minsAgo(row.reviewed_at),
          // Full transcripts are intentionally not persisted (privacy); the
          // flagged quote is the available evidence line.
          transcript: finding.quote
            ? [{ role: 'assistant', flag: true, text: finding.quote }]
            : [],
          reason: finding.detail,
        });
      });
    }

    return { flags };
  }

  async getQaHealth(): Promise<QaHealthResponse> {
    const { rows } = await query<{
      account_name: string;
      reviewed: number | string;
      avg_score: number | string | null;
      flags_wk: number | string;
      last_flag_at: Date | string | null;
    }>(
      `SELECT a.name AS account_name,
              COUNT(*)::INT AS reviewed,
              ROUND(AVG(qr.score))::INT AS avg_score,
              COUNT(*) FILTER (
                WHERE qr.pass = FALSE AND qr.reviewed_at >= NOW() - INTERVAL '7 days'
              )::INT AS flags_wk,
              MAX(qr.reviewed_at) FILTER (WHERE qr.pass = FALSE) AS last_flag_at
       FROM qa_reviews qr
       JOIN accounts a ON a.id = qr.account_id
       GROUP BY a.name
       ORDER BY avg_score ASC NULLS FIRST`,
    );

    const health: QaHealth[] = rows.map((row) => {
      const score = row.avg_score === null ? 100 : clamp(Math.round(Number(row.avg_score)), 0, 100);
      return {
        acct: row.account_name,
        score,
        slope: 0,
        flagsWk: Number(row.flags_wk),
        status: qaStatusFor(score),
        // No per-day series is stored yet; render a flat trend at the average
        // until a daily QA rollup table exists.
        trend: Array.from({ length: 10 }, () => score),
        lastFlag: row.last_flag_at ? fmtAgo(minsAgo(row.last_flag_at)) : '—',
        reviewed: Number(row.reviewed),
      };
    });

    return { health };
  }

  async resolveQaFlag(
    flagId: string,
    decision: QaDecision,
    operator: string,
  ): Promise<ResolveQaFlagResponse> {
    const [reviewId, indexPart] = flagId.split(':');
    if (!reviewId) {
      throw new ValidationError(`Invalid QA flag id: ${flagId}`);
    }
    const findingIndex = Number.isFinite(Number(indexPart)) ? Number(indexPart) : null;

    const { rows } = await query<{ account_name: string; findings: unknown }>(
      `SELECT a.name AS account_name, qr.findings
       FROM qa_reviews qr JOIN accounts a ON a.id = qr.account_id
       WHERE qr.id = $1 LIMIT 1`,
      [reviewId],
    );
    const review = rows[0];
    if (!review) {
      throw new NotFoundError(`QA review not found: ${reviewId}`);
    }

    await query(
      `INSERT INTO qa_flag_resolutions (qa_review_id, flag_key, finding_index, decision, resolved_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (flag_key) DO NOTHING`,
      [reviewId, flagId, findingIndex, decision, operator],
    );

    const findings = parseFindings(review.findings);
    const category =
      findingIndex !== null && findings[findingIndex]
        ? coerceCategory(findings[findingIndex].category)
        : 'off-script';

    const auditEntry = await this.writeAudit({
      accountName: review.account_name,
      action: `${decision === 'confirm' ? 'QA flag confirmed' : 'QA flag dismissed'} — ${category}`,
      detail:
        decision === 'confirm'
          ? 'real issue · assistant flagged for tuning · added to QA training set'
          : 'marked false positive · fed back to QA tuning set',
      actor: `human:${operator}`,
      mutated: false,
      result: decision === 'confirm' ? 'pending' : 'info',
    });

    return { flagId, decision, auditEntry };
  }

  async getAudit(): Promise<AuditResponse> {
    const { rows } = await query<{
      id: string | number;
      actor: string;
      action: string;
      target: string;
      mutated: boolean;
      output: unknown;
      timestamp: Date | string;
      account_name: string | null;
    }>(
      `SELECT al.id, al.actor, al.action, al.target, al.mutated, al.output, al.timestamp,
              acc.name AS account_name
       FROM audit_log al
       LEFT JOIN accounts acc ON acc.id::text = al.target
       ORDER BY al.id DESC
       LIMIT 100`,
    );

    const entries: AuditEntry[] = rows.map((row) => {
      const seq = Number(row.id);
      return {
        seq,
        acct: row.account_name ?? row.target,
        action: row.action,
        detail: summarizeOutput(row.output, row.mutated),
        trigger: deriveTrigger(row.actor),
        who: row.actor,
        result: deriveResult(row.output, row.mutated),
        min: minsAgo(row.timestamp),
        ts: fmtAgo(minsAgo(row.timestamp)),
        hash: displayHash(seq),
        prev: displayHash(seq - 1),
      };
    });

    return { entries };
  }

  private async loadAccounts(filter?: { id?: string }): Promise<Account[]> {
    const params: unknown[] = [];
    let where = "WHERE status <> 'churned'";
    if (filter?.id) {
      params.push(filter.id);
      // Accept both the real UUID and the synthetic acc_NN display id.
      where = `WHERE id::text = $1 OR name = $1`;
    }

    const { rows } = await query<AccountRow>(
      `SELECT id, name, ghl_location_id, assistable_subaccount_id, n8n_workflow_ids,
              status, ghl_token_status, assistable_oauth_status, n8n_workflow_status,
              updated_at, metadata
       FROM accounts
       ${where}
       ORDER BY name ASC`,
      params,
    );

    return rows.map((row, index) => deriveAccountView(row, index));
  }

  private async writeAudit(input: {
    accountName: string;
    action: string;
    detail: string;
    actor: string;
    mutated: boolean;
    result: AuditEntry['result'];
    approvalId?: string;
  }): Promise<AuditEntry> {
    const { rows } = await query<{ id: string | number; timestamp: Date | string }>(
      `INSERT INTO audit_log (actor, action, target, mutated, output, approval_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, timestamp`,
      [
        input.actor,
        input.action,
        input.accountName,
        input.mutated,
        JSON.stringify({ detail: input.detail, result: input.result }),
        input.approvalId ?? null,
      ],
    );
    const row = rows[0];
    const seq = Number(row?.id ?? 0);
    return {
      seq,
      acct: input.accountName,
      action: input.action,
      detail: input.detail,
      trigger: deriveTrigger(input.actor),
      who: input.actor,
      result: input.result,
      min: 0,
      ts: 'just now',
      hash: displayHash(seq),
      prev: displayHash(seq - 1),
    };
  }
}

// ---- enum coercion tables ----
const REQUEST_STATUSES = ['new', 'triaging', 'awaiting', 'progress', 'done'] as const;
const CHANNELS = ['auto', 'system', 'human', 'rule'] as const;
const PRIORITIES = ['high', 'med', 'low'] as const;

function coerceEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function coerceCategory(value: string): QaCategory {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  const parsed = qaCategorySchema.safeParse(normalized);
  return parsed.success ? parsed.data : 'off-script';
}

function mapFindingSeverity(severity: string): QaFlag['severity'] {
  if (severity === 'critical' || severity === 'major') return 'high';
  if (severity === 'minor') return 'med';
  return 'low';
}

interface ParsedFinding {
  severity: string;
  category: string;
  detail: string;
  quote?: string;
}

function parseFindings(value: unknown): ParsedFinding[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      severity: String(f.severity ?? 'info'),
      category: String(f.category ?? 'off-script'),
      detail: String(f.detail ?? ''),
      quote: typeof f.quote === 'string' ? f.quote : undefined,
    }));
}

function deriveAccountView(row: AccountRow, index: number): Account {
  const ghlBad = isGhlTokenBad(row.ghl_token_status);
  const assistableConnected = isAssistableConnected(row.assistable_oauth_status);
  const n8nStatus = row.n8n_workflow_status;
  const n8nErr = n8nStatus === 'needs-attention';
  const isOnboarding = !row.ghl_location_id && !row.assistable_subaccount_id;

  let status: Account['status'];
  if (isOnboarding) {
    status = 'onboarding';
  } else if (ghlBad || !assistableConnected) {
    status = 'down';
  } else if (n8nErr || row.ghl_token_status === null) {
    status = 'attention';
  } else {
    status = 'healthy';
  }

  const pit: Account['pit'] = ghlBad ? 'expired' : 'valid';
  const n8nIds = row.n8n_workflow_ids ?? [];
  const meta = (row.metadata ?? {}) as Record<string, { workflowCount?: number }>;
  const n8nCount = n8nIds.length || Number(meta.n8nWorkflowHealth?.workflowCount ?? 0);
  const lastMin = minsAgo(row.updated_at);

  return {
    id: row.id,
    locationId: row.ghl_location_id,
    name: row.name,
    vert: deriveVertical(row.name),
    vertLabel: VERT_LABEL[deriveVertical(row.name)],
    status,
    initials: deriveInitials(row.name),
    tint: FLEET_TINTS[index % FLEET_TINTS.length],
    pit,
    // PIT days-to-expiry is not tracked as a column yet (gap): valid -> nominal
    // horizon, bad -> expired sentinel.
    pitDays: pit === 'valid' ? 60 : -1,
    assistable: assistableConnected ? 'connected' : 'disconnected',
    assistantId: row.assistable_subaccount_id,
    n8n: n8nIds.length || n8nStatus === 'healthy' ? 'active' : 'none',
    n8nCount,
    n8nErr,
    lastMin,
    lastActivity: fmtAgo(lastMin),
    issue: deriveIssue(status, row),
    // Per-day activity series is not stored yet (gap): flat placeholder.
    spark: Array.from({ length: 7 }, () => (status === 'down' ? 1 : 8)),
    // Assistable minute-cap usage is not stored yet (gap).
    minuteCap: 0,
  };
}

const VERT_LABEL: Record<Account['vert'], string> = {
  mortgage: 'Mortgage',
  realestate: 'Real Estate',
  insurance: 'Insurance',
};

function deriveVertical(name: string): Account['vert'] {
  const n = name.toLowerCase();
  if (n.includes('realty') || n.includes('properties') || n.includes('homes') || n.includes('real estate')) {
    return 'realestate';
  }
  if (n.includes('insurance') || n.includes('coverage') || n.includes('risk')) {
    return 'insurance';
  }
  return 'mortgage';
}

function deriveInitials(name: string): string {
  const w = name.replace(/&/g, '').split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '??';
}

function deriveIssue(status: Account['status'], row: AccountRow): string | null {
  if (status === 'healthy') return null;
  if (isGhlTokenBad(row.ghl_token_status)) return `GHL token status: ${row.ghl_token_status}.`;
  if (!isAssistableConnected(row.assistable_oauth_status)) return 'Assistable connection needs attention.';
  if (row.n8n_workflow_status === 'needs-attention') return 'n8n workflows need attention.';
  if (status === 'onboarding') return 'New client — integrations not yet provisioned.';
  return 'Needs attention.';
}

function isGhlTokenBad(status: string | null): boolean {
  if (!status) return false;
  return status !== 'valid';
}

function isAssistableConnected(status: string | null): boolean {
  if (!status) return true;
  return ['connected', 'ok', 'valid', 'active'].includes(status.toLowerCase());
}

function humanizeSkill(skill: string): string {
  return skill
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function deriveDiff(proposedAction: unknown): ApprovalDiff[] {
  let value: unknown = proposedAction;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 6)
    .map(([k, v]) => ({ k, from: '—', to: stringifyValue(v) }));
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function deriveTrigger(actor: string): Trigger {
  if (actor.startsWith('human:')) return 'operator';
  if (actor.includes('rule') || actor.includes('cron') || actor.includes('schedule')) return 'rule';
  return 'system';
}

function deriveResult(output: unknown, mutated: boolean): AuditEntry['result'] {
  const obj = asObject(output);
  if (obj && typeof obj.result === 'string') {
    const r = obj.result.toLowerCase();
    if (r === 'ok' || r === 'fail' || r === 'pending' || r === 'info') return r;
  }
  return mutated ? 'ok' : 'info';
}

function summarizeOutput(output: unknown, mutated: boolean): string {
  const obj = asObject(output);
  if (obj && typeof obj.detail === 'string') return obj.detail;
  return mutated ? 'state change applied' : 'read action';
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

async function accountNameForJob(jobId: string): Promise<string | null> {
  const { rows } = await query<{ name: string }>(
    `SELECT a.name FROM jobs j JOIN accounts a ON a.id = j.account_id WHERE j.id = $1 LIMIT 1`,
    [jobId],
  );
  return rows[0]?.name ?? null;
}

function minsAgo(ts: Date | string): number {
  const time = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 60000));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function displayHash(seq: number): string {
  if (seq < 0) return '00000000';
  let h = 2166136261 >>> 0;
  const s = `audit:${seq}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `00000000${(h >>> 0).toString(16)}`.slice(-8);
}
