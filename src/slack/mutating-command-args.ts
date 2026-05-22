import { ValidationError } from '../lib/errors.js';
import { looksLikeWorkflowId } from '../lib/n8n/resolve-workflow-id.js';

export function parseTriggerN8nCommandArgs(parts: string[]): {
  accountQuery: string;
  workflowId?: string;
} {
  const rest = parts.slice(1);
  if (rest.length === 0) {
    throw new ValidationError('Account name is required');
  }

  if (rest.length >= 2 && looksLikeWorkflowId(rest[rest.length - 1] ?? '')) {
    const workflowId = rest.pop();
    return {
      accountQuery: rest.join(' '),
      workflowId,
    };
  }

  return {
    accountQuery: rest.join(' '),
  };
}
