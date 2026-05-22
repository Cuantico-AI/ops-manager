import { formatSetCustomValueOutput, type SetCustomValueOutput } from '../../skills/ghl/set-custom-value.js';
import {
  formatRefreshAssistableOAuthOutput,
  type RefreshAssistableOAuthOutput,
} from '../../skills/assistable/refresh-oauth.js';
import {
  formatTriggerWorkflowOutput,
  type TriggerWorkflowOutput,
} from '../../skills/n8n/trigger-workflow.js';

export function formatApprovalResumeResult(output: unknown): string {
  if (
    output &&
    typeof output === 'object' &&
    'customValueId' in output &&
    'accountName' in output
  ) {
    return formatSetCustomValueOutput(output as SetCustomValueOutput);
  }

  if (
    output &&
    typeof output === 'object' &&
    'executionId' in output &&
    'workflowId' in output &&
    'accountName' in output
  ) {
    return formatTriggerWorkflowOutput(output as TriggerWorkflowOutput);
  }

  if (
    output &&
    typeof output === 'object' &&
    'currentStatus' in output &&
    'previousStatus' in output &&
    'assistableLocationId' in output &&
    'accountName' in output
  ) {
    return formatRefreshAssistableOAuthOutput(output as RefreshAssistableOAuthOutput);
  }

  return 'Approval accepted and job completed.';
}
