import { query } from '../db/client.js';
import { ApprovalExpiredError, NotFoundError, ValidationError } from '../errors.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRecord {
  id: string;
  jobId: string;
  skill: string;
  targetSummary: string;
  proposedAction: unknown;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  slackMessageTs: string | null;
  expiresAt: string;
}

export function getApprovalExpiryHours(): number {
  const configured = Number(process.env.APPROVAL_EXPIRY_HOURS ?? 4);
  return Number.isFinite(configured) && configured > 0 ? configured : 4;
}

export async function createApproval(input: {
  jobId: string;
  skill: string;
  targetSummary: string;
  proposedAction: unknown;
}): Promise<ApprovalRecord> {
  const expiresAt = new Date(Date.now() + getApprovalExpiryHours() * 60 * 60 * 1000).toISOString();

  const { rows } = await query<{
    id: string;
    job_id: string;
    skill: string;
    target_summary: string;
    proposed_action: unknown;
    status: ApprovalStatus;
    requested_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    slack_message_ts: string | null;
    expires_at: Date;
  }>(
    `INSERT INTO approvals (
       job_id, skill, target_summary, proposed_action, status, expires_at
     )
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id, job_id, skill, target_summary, proposed_action, status,
               requested_at, resolved_at, resolved_by, slack_message_ts, expires_at`,
    [input.jobId, input.skill, input.targetSummary, JSON.stringify(input.proposedAction), expiresAt],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create approval record');
  }

  return mapApprovalRow(row);
}

export async function findApprovedApprovalForJob(jobId: string): Promise<ApprovalRecord | null> {
  const { rows } = await query<{
    id: string;
    job_id: string;
    skill: string;
    target_summary: string;
    proposed_action: unknown;
    status: ApprovalStatus;
    requested_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    slack_message_ts: string | null;
    expires_at: Date;
  }>(
    `SELECT id, job_id, skill, target_summary, proposed_action, status,
            requested_at, resolved_at, resolved_by, slack_message_ts, expires_at
     FROM approvals
     WHERE job_id = $1 AND status = 'approved'
     ORDER BY resolved_at DESC NULLS LAST
     LIMIT 1`,
    [jobId],
  );

  return rows[0] ? mapApprovalRow(rows[0]) : null;
}

export async function findPendingApprovalForJob(jobId: string): Promise<ApprovalRecord | null> {
  const { rows } = await query<{
    id: string;
    job_id: string;
    skill: string;
    target_summary: string;
    proposed_action: unknown;
    status: ApprovalStatus;
    requested_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    slack_message_ts: string | null;
    expires_at: Date;
  }>(
    `SELECT id, job_id, skill, target_summary, proposed_action, status,
            requested_at, resolved_at, resolved_by, slack_message_ts, expires_at
     FROM approvals
     WHERE job_id = $1 AND status = 'pending'
     ORDER BY requested_at DESC
     LIMIT 1`,
    [jobId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const approval = mapApprovalRow(row);
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    await markApprovalExpired(approval.id);
    return null;
  }

  return approval;
}

export async function getApprovalById(approvalId: string): Promise<ApprovalRecord> {
  const { rows } = await query<{
    id: string;
    job_id: string;
    skill: string;
    target_summary: string;
    proposed_action: unknown;
    status: ApprovalStatus;
    requested_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    slack_message_ts: string | null;
    expires_at: Date;
  }>(
    `SELECT id, job_id, skill, target_summary, proposed_action, status,
            requested_at, resolved_at, resolved_by, slack_message_ts, expires_at
     FROM approvals
     WHERE id = $1
     LIMIT 1`,
    [approvalId],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Approval not found: ${approvalId}`);
  }

  return mapApprovalRow(row);
}

export async function setApprovalSlackMessageTs(
  approvalId: string,
  slackMessageTs: string,
): Promise<void> {
  await query(`UPDATE approvals SET slack_message_ts = $1 WHERE id = $2`, [
    slackMessageTs,
    approvalId,
  ]);
}

export async function resolveApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  resolvedBy: string,
): Promise<ApprovalRecord> {
  const approval = await getApprovalById(approvalId);

  if (approval.status !== 'pending') {
    throw new ValidationError(`Approval ${approvalId} is already ${approval.status}`);
  }

  if (Date.parse(approval.expiresAt) <= Date.now()) {
    await markApprovalExpired(approvalId);
    throw new ApprovalExpiredError(approvalId);
  }

  const { rows } = await query<{
    id: string;
    job_id: string;
    skill: string;
    target_summary: string;
    proposed_action: unknown;
    status: ApprovalStatus;
    requested_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    slack_message_ts: string | null;
    expires_at: Date;
  }>(
    `UPDATE approvals
     SET status = $1,
         resolved_at = NOW(),
         resolved_by = $2
     WHERE id = $3
     RETURNING id, job_id, skill, target_summary, proposed_action, status,
               requested_at, resolved_at, resolved_by, slack_message_ts, expires_at`,
    [status, resolvedBy, approvalId],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Approval not found: ${approvalId}`);
  }

  return mapApprovalRow(row);
}

export async function markApprovalExpired(approvalId: string): Promise<void> {
  await query(
    `UPDATE approvals
     SET status = 'expired',
         resolved_at = COALESCE(resolved_at, NOW())
     WHERE id = $1 AND status = 'pending'`,
    [approvalId],
  );
}

export async function setJobStatus(jobId: string, status: string): Promise<void> {
  await query(
    `UPDATE jobs
     SET status = $1,
         completed_at = CASE WHEN $1 IN ('succeeded', 'failed', 'cancelled') THEN NOW() ELSE completed_at END
     WHERE id = $2`,
    [status, jobId],
  );
}

export async function listRecentJobs(limit = 20): Promise<
  Array<{
    id: string;
    agentId: string;
    triggerType: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>
> {
  const { rows } = await query<{
    id: string;
    agent_id: string;
    trigger_type: string;
    status: string;
    started_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT id, agent_id, trigger_type, status, started_at, completed_at
     FROM jobs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  }));
}

function mapApprovalRow(row: {
  id: string;
  job_id: string;
  skill: string;
  target_summary: string;
  proposed_action: unknown;
  status: ApprovalStatus;
  requested_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  slack_message_ts: string | null;
  expires_at: Date;
}): ApprovalRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    skill: row.skill,
    targetSummary: row.target_summary,
    proposedAction:
      typeof row.proposed_action === 'string'
        ? JSON.parse(row.proposed_action)
        : row.proposed_action,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedBy: row.resolved_by,
    slackMessageTs: row.slack_message_ts,
    expiresAt: row.expires_at.toISOString(),
  };
}
