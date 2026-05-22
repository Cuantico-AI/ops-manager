import { query } from '../db/client.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { auditLogger } from '../audit/log.js';
import { approvalGate } from './gate.js';
import { resolveApproval, setJobStatus } from './store.js';
import { updateApprovalMessage } from './slack-flow.js';
import { llmClient } from '../llm/client.js';
import type { SkillRegistry } from '../../skills/_registry.js';
import type { Skill, SkillContext } from '../../skills/_types.js';

export async function rejectApprovalRequest(
  approvalId: string,
  resolvedBy: string,
): Promise<void> {
  const approval = await resolveApproval(approvalId, 'rejected', resolvedBy);
  await setJobStatus(approval.jobId, 'cancelled');
  await updateApprovalMessage(approval, 'rejected', resolvedBy);
}

export async function approveAndResumeJob(
  registry: SkillRegistry,
  approvalId: string,
  resolvedBy: string,
): Promise<unknown> {
  const approval = await resolveApproval(approvalId, 'approved', resolvedBy);
  await updateApprovalMessage(approval, 'approved', resolvedBy);
  await setJobStatus(approval.jobId, 'running');

  try {
    const output = await executeApprovedJob(registry, approval, resolvedBy);

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify(output),
      approval.jobId,
    ]);

    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      approval.jobId,
    ]);
    throw err;
  }
}

async function executeApprovedJob(
  registry: SkillRegistry,
  approval: { id: string; jobId: string; skill: string; proposedAction: unknown },
  resolvedBy: string,
): Promise<unknown> {
  const skill = registry.get(approval.skill) as Skill<unknown, unknown>;
  const ctx: SkillContext = {
    jobId: approval.jobId,
    agentId: `human:${resolvedBy}`,
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  const output = await skill.execute(approval.proposedAction, ctx);
  return output;
}

export async function getJobRecord(jobId: string): Promise<{
  id: string;
  status: string;
  input: unknown;
}> {
  const { rows } = await query<{ id: string; status: string; input: unknown }>(
    `SELECT id, status, input FROM jobs WHERE id = $1 LIMIT 1`,
    [jobId],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Job not found: ${jobId}`);
  }

  return {
    id: row.id,
    status: row.status,
    input: typeof row.input === 'string' ? JSON.parse(row.input) : row.input,
  };
}

export function assertApprovalId(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(trimmed)) {
    throw new ValidationError('Approval ID must be a UUID');
  }
  return trimmed;
}
