import type { N8nExecution, N8nWorkflow } from './client.js';

export type N8nWorkflowHealthStatus =
  | 'healthy'
  | 'inactive'
  | 'failing'
  | 'stale'
  | 'not_found'
  | 'unreachable';

export interface N8nWorkflowHealthSnapshot {
  workflowId: string;
  workflowName: string;
  active: boolean;
  status: N8nWorkflowHealthStatus;
  lastRunAt?: string;
  lastRunStatus?: string;
  recentExecutions: number;
  recentErrors: number;
  message?: string;
}

export function getN8nStaleExecutionHours(): number {
  const configured = Number(process.env.N8N_STALE_EXECUTION_HOURS ?? 24);
  return Number.isFinite(configured) && configured > 0 ? configured : 24;
}

export function evaluateWorkflowHealth(
  workflow: N8nWorkflow,
  executions: N8nExecution[],
  staleHours = getN8nStaleExecutionHours(),
): N8nWorkflowHealthSnapshot {
  const finishedExecutions = executions
    .filter((execution) => execution.finished)
    .sort((left, right) => {
      const leftTime = Date.parse(left.stoppedAt ?? left.startedAt ?? '0');
      const rightTime = Date.parse(right.stoppedAt ?? right.startedAt ?? '0');
      return rightTime - leftTime;
    });

  const recentErrors = finishedExecutions.filter((execution) => isErrorStatus(execution.status)).length;
  const lastRun = finishedExecutions[0];

  if (!workflow.active) {
    return buildSnapshot(workflow, 'inactive', finishedExecutions, recentErrors, lastRun);
  }

  if (lastRun && isErrorStatus(lastRun.status)) {
    return buildSnapshot(workflow, 'failing', finishedExecutions, recentErrors, lastRun);
  }

  if (!lastRun || isStale(lastRun, staleHours)) {
    return buildSnapshot(workflow, 'stale', finishedExecutions, recentErrors, lastRun, {
      message: lastRun
        ? `Last run was ${lastRun.stoppedAt ?? lastRun.startedAt ?? 'unknown'}`
        : 'No finished executions found',
    });
  }

  return buildSnapshot(workflow, 'healthy', finishedExecutions, recentErrors, lastRun);
}

function buildSnapshot(
  workflow: N8nWorkflow,
  status: N8nWorkflowHealthStatus,
  finishedExecutions: N8nExecution[],
  recentErrors: number,
  lastRun?: N8nExecution,
  extra: { message?: string } = {},
): N8nWorkflowHealthSnapshot {
  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    active: workflow.active,
    status,
    lastRunAt: lastRun?.stoppedAt ?? lastRun?.startedAt,
    lastRunStatus: lastRun?.status,
    recentExecutions: finishedExecutions.length,
    recentErrors,
    message: extra.message,
  };
}

function isErrorStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'error' || normalized === 'crashed' || normalized === 'canceled';
}

function isStale(lastRun: N8nExecution, staleHours: number): boolean {
  const timestamp = Date.parse(lastRun.stoppedAt ?? lastRun.startedAt ?? '');
  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return Date.now() - timestamp > staleHours * 60 * 60 * 1000;
}

export function summarizeAccountWorkflowHealth(
  workflows: N8nWorkflowHealthSnapshot[],
): 'healthy' | 'needs-attention' {
  const needsAttention = workflows.some((workflow) =>
    ['failing', 'stale', 'not_found', 'unreachable'].includes(workflow.status),
  );
  return needsAttention ? 'needs-attention' : 'healthy';
}
