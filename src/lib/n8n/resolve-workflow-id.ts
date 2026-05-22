import { ValidationError } from '../errors.js';

export function looksLikeWorkflowId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,}$/.test(value) && /[0-9_-]/.test(value);
}

export function resolveTrackedWorkflowId(
  workflowIds: string[],
  workflowId?: string,
): string {
  if (workflowId) {
    if (workflowIds.length > 0 && !workflowIds.includes(workflowId)) {
      throw new ValidationError(
        `Workflow ID ${workflowId} is not tracked for this account in the roster`,
      );
    }
    return workflowId;
  }

  if (workflowIds.length === 0) {
    throw new ValidationError('Account has no n8n workflow IDs in the roster');
  }

  if (workflowIds.length > 1) {
    throw new ValidationError(
      `Account has multiple tracked workflows (${workflowIds.join(', ')}). Specify a workflow ID.`,
    );
  }

  return workflowIds[0]!;
}
