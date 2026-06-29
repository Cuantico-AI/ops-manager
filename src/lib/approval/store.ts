import { prisma } from '../db/prisma.js';
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
  const expiresAt = new Date(Date.now() + getApprovalExpiryHours() * 60 * 60 * 1000);

  const row = await prisma.approvals.create({
    data: {
      job_id: input.jobId,
      skill: input.skill,
      target_summary: input.targetSummary,
      proposed_action: JSON.stringify(input.proposedAction),
      status: 'pending',
      expires_at: expiresAt,
    },
  });

  return mapApprovalRow(row);
}

export async function findApprovedApprovalForJob(jobId: string): Promise<ApprovalRecord | null> {
  const row = await prisma.approvals.findFirst({
    where: { job_id: jobId, status: 'approved' },
    orderBy: { resolved_at: { sort: 'desc', nulls: 'last' } },
  });

  return row ? mapApprovalRow(row) : null;
}

export async function findPendingApprovalForJob(jobId: string): Promise<ApprovalRecord | null> {
  const row = await prisma.approvals.findFirst({
    where: { job_id: jobId, status: 'pending' },
    orderBy: { requested_at: 'desc' },
  });

  if (!row) return null;

  const approval = mapApprovalRow(row);
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    await markApprovalExpired(approval.id);
    return null;
  }

  return approval;
}

export async function getApprovalById(approvalId: string): Promise<ApprovalRecord> {
  const row = await prisma.approvals.findUnique({
    where: { id: approvalId },
  });

  if (!row) {
    throw new NotFoundError(`Approval not found: ${approvalId}`);
  }

  return mapApprovalRow(row);
}

export async function setApprovalSlackMessageTs(
  approvalId: string,
  slackMessageTs: string,
): Promise<void> {
  await prisma.approvals.update({
    where: { id: approvalId },
    data: { slack_message_ts: slackMessageTs },
  });
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

  const row = await prisma.approvals.update({
    where: { id: approvalId },
    data: {
      status,
      resolved_at: new Date(),
      resolved_by: resolvedBy,
    },
  });

  return mapApprovalRow(row);
}

export async function markApprovalExpired(approvalId: string): Promise<void> {
  await prisma.approvals.updateMany({
    where: { id: approvalId, status: 'pending' },
    data: {
      status: 'expired',
      resolved_at: new Date(),
    },
  });
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
  const rows = await prisma.jobs.findMany({
    select: {
      id: true,
      agent_id: true,
      trigger_type: true,
      status: true,
      started_at: true,
      completed_at: true,
    },
    orderBy: { started_at: 'desc' },
    take: limit,
  });

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
  status: string;
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
    status: row.status as ApprovalStatus,
    requestedAt: row.requested_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedBy: row.resolved_by,
    slackMessageTs: row.slack_message_ts,
    expiresAt: row.expires_at.toISOString(),
  };
}