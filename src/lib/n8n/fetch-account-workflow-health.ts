import { ExternalServiceError } from '../errors.js';
import { n8nClient, type N8nClient } from '../n8n/client.js';
import {
  evaluateWorkflowHealth,
  summarizeAccountWorkflowHealth,
  type N8nWorkflowHealthSnapshot,
} from '../n8n/workflow-health.js';
import type { N8nAccountForWorkflowCheck } from '../accounts/n8n-workflow-health.js';

export async function checkAccountWorkflows(
  account: N8nAccountForWorkflowCheck,
  client: N8nClient = n8nClient,
): Promise<N8nWorkflowHealthSnapshot[]> {
  const workflows: N8nWorkflowHealthSnapshot[] = [];

  for (const workflowId of account.n8nWorkflowIds) {
    try {
      const workflow = await client.getWorkflow(workflowId);
      const executions = await client.listExecutions(workflowId);
      workflows.push(evaluateWorkflowHealth(workflow, executions));
    } catch (err) {
      workflows.push(buildWorkflowError(workflowId, err));
    }
  }

  return workflows;
}

export function buildAccountWorkflowResult(
  account: N8nAccountForWorkflowCheck,
  workflows: N8nWorkflowHealthSnapshot[],
  checkedAt: string,
): {
  accountId: string;
  accountName: string;
  status: 'healthy' | 'needs-attention' | 'missing-workflow-ids';
  workflows: N8nWorkflowHealthSnapshot[];
  checkedAt: string;
} {
  if (account.n8nWorkflowIds.length === 0) {
    return {
      accountId: account.id,
      accountName: account.name,
      status: 'missing-workflow-ids',
      workflows: [],
      checkedAt,
    };
  }

  return {
    accountId: account.id,
    accountName: account.name,
    status: summarizeAccountWorkflowHealth(workflows),
    workflows,
    checkedAt,
  };
}

function buildWorkflowError(workflowId: string, err: unknown): N8nWorkflowHealthSnapshot {
  if (err instanceof ExternalServiceError && err.code === 'N8N_NOT_FOUND') {
    return {
      workflowId,
      workflowName: workflowId,
      active: false,
      status: 'not_found',
      recentExecutions: 0,
      recentErrors: 0,
      message: err.message,
    };
  }

  if (err instanceof ExternalServiceError && err.code === 'N8N_AUTH_ERROR') {
    throw err;
  }

  return {
    workflowId,
    workflowName: workflowId,
    active: false,
    status: 'unreachable',
    recentExecutions: 0,
    recentErrors: 0,
    message: err instanceof Error ? err.message : String(err),
  };
}
