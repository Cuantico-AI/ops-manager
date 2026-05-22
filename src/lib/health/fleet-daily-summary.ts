import type { CheckAssistableOAuthOutput } from '../../skills/assistable/check-oauth-status.js';
import type { CheckPitTokenOutput } from '../../skills/ghl/check-pit-token.js';
import type { CheckN8nWorkflowHealthOutput } from '../../skills/n8n/check-workflow-health.js';

export interface FleetDailyHealthChecks {
  ghl: CheckPitTokenOutput;
  assistable: CheckAssistableOAuthOutput;
  n8n: CheckN8nWorkflowHealthOutput;
}

export function formatFleetDailyHealthOverview(checks: FleetDailyHealthChecks): string {
  const { ghl, assistable, n8n } = checks;
  const ghlIssues = ghl.summary.needsAttention;
  const assistableIssues = assistable.summary.needsAttention;
  const n8nIssues = n8n.summary.needsAttention + n8n.summary.missingWorkflowIds;
  const totalIssues = ghlIssues + assistableIssues + n8nIssues;

  const lines = [
    'Daily fleet health summary.',
    `Checked at: ${ghl.checkedAt}`,
    '',
    'GHL PIT tokens',
    `• Checked: ${ghl.summary.total}`,
    `• Valid: ${ghl.summary.valid}`,
    `• Needs attention: ${ghl.summary.needsAttention}`,
    '',
    'Assistable OAuth',
    `• Checked: ${assistable.summary.total}`,
    `• Connected: ${assistable.summary.connected}`,
    `• Needs attention: ${assistable.summary.needsAttention}`,
    '',
    'n8n workflows',
    `• Checked: ${n8n.summary.total}`,
    `• Healthy: ${n8n.summary.healthy}`,
    `• Needs attention: ${n8n.summary.needsAttention}`,
    `• Missing workflow IDs: ${n8n.summary.missingWorkflowIds}`,
    `• Not found in n8n: ${n8n.summary.notFoundWorkflows}`,
    '',
    totalIssues === 0
      ? 'All checked accounts are healthy across GHL, Assistable, and n8n.'
      : `${totalIssues} account issue(s) across the fleet. See thread for details.`,
  ];

  return lines.join('\n');
}

export function isFleetDailyHealthEnabled(): boolean {
  const configured = process.env.FLEET_DAILY_HEALTH_ENABLED;
  if (configured === undefined) {
    return true;
  }

  return configured.toLowerCase() !== 'false';
}
