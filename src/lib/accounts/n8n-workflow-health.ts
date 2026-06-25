import { prisma } from '../db/prisma.js';
import { query } from '../db/client.js';
import type { N8nWorkflowHealthSnapshot } from '../n8n/workflow-health.js';

export type N8nAccountWorkflowStatus = 'healthy' | 'needs-attention' | 'missing-workflow-ids';

export interface N8nAccountForWorkflowCheck {
  id: string;
  name: string;
  status: string;
  n8nWorkflowIds: string[];
}

export interface N8nAccountWorkflowCheckResult {
  accountId: string;
  accountName: string;
  status: N8nAccountWorkflowStatus;
  workflows: N8nWorkflowHealthSnapshot[];
  checkedAt: string;
}

export interface N8nWorkflowCheckSummary {
  total: number;
  healthy: number;
  needsAttention: number;
  missingWorkflowIds: number;
  inactiveWorkflows: number;
  failingWorkflows: number;
  staleWorkflows: number;
  notFoundWorkflows: number;
  unreachableWorkflows: number;
}

export async function listAccountsForN8nWorkflowCheck(opts: {
  accountId?: string;
  accountQuery?: string;
  includeInactive?: boolean;
}): Promise<N8nAccountForWorkflowCheck[]> {
  const rows = await prisma.accounts.findMany({
    where: {
      ...(opts.accountId ? { id: opts.accountId } : {}),
      ...(opts.accountQuery
        ? { name: { contains: opts.accountQuery, mode: 'insensitive' } }
        : {}),
      ...(!opts.includeInactive ? { status: 'active' } : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      n8n_workflow_ids: true,
    },
    orderBy: { name: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    n8nWorkflowIds: row.n8n_workflow_ids ?? [],
  }));
}

export async function saveN8nWorkflowCheckResult(result: N8nAccountWorkflowCheckResult): Promise<void> {
  await query(
    `UPDATE accounts
     SET n8n_workflow_status = $1,
         n8n_workflow_checked_at = $2,
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $4`,
    [
      result.status,
      result.checkedAt,
      JSON.stringify({
        n8nWorkflowHealth: {
          status: result.status,
          workflowCount: result.workflows.length,
          failingWorkflows: result.workflows.filter((workflow) => workflow.status === 'failing').length,
          staleWorkflows: result.workflows.filter((workflow) => workflow.status === 'stale').length,
          checkedAt: result.checkedAt,
        },
      }),
      result.accountId,
    ],
  );
}

export function summarizeN8nWorkflowChecks(
  results: N8nAccountWorkflowCheckResult[],
): N8nWorkflowCheckSummary {
  const summary: N8nWorkflowCheckSummary = {
    total: results.length,
    healthy: 0,
    needsAttention: 0,
    missingWorkflowIds: 0,
    inactiveWorkflows: 0,
    failingWorkflows: 0,
    staleWorkflows: 0,
    notFoundWorkflows: 0,
    unreachableWorkflows: 0,
  };

  for (const result of results) {
    if (result.status === 'healthy') summary.healthy += 1;
    if (result.status === 'needs-attention') summary.needsAttention += 1;
    if (result.status === 'missing-workflow-ids') summary.missingWorkflowIds += 1;

    for (const workflow of result.workflows) {
      if (workflow.status === 'inactive') summary.inactiveWorkflows += 1;
      if (workflow.status === 'failing') summary.failingWorkflows += 1;
      if (workflow.status === 'stale') summary.staleWorkflows += 1;
      if (workflow.status === 'not_found') summary.notFoundWorkflows += 1;
      if (workflow.status === 'unreachable') summary.unreachableWorkflows += 1;
    }
  }

  return summary;
}