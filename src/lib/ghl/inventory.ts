import type { GhlCustomField, GhlWorkflow } from './client.js';

export interface GhlAccountInventory {
  accountId: string;
  accountName: string;
  locationId: string;
  workflows: GhlWorkflow[];
  customFields: GhlCustomField[];
  capturedAt: string;
}

export interface WorkflowStatusSummary {
  status: string;
  count: number;
}

export function summarizeWorkflowStatuses(workflows: GhlWorkflow[]): WorkflowStatusSummary[] {
  const counts = new Map<string, number>();
  for (const workflow of workflows) {
    counts.set(workflow.status, (counts.get(workflow.status) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => left.status.localeCompare(right.status));
}

export function formatGhlAccountInventory(inventory: GhlAccountInventory): string {
  const workflowSummary = summarizeWorkflowStatuses(inventory.workflows);
  const publishedCount = inventory.workflows.filter(
    (workflow) => workflow.status.toLowerCase() === 'published',
  ).length;

  const lines = [
    `GHL inventory — ${inventory.accountName}`,
    `Location ID: ${inventory.locationId}`,
    `Workflows: ${inventory.workflows.length} (${publishedCount} published)`,
    ...workflowSummary.map((entry) => `• status ${entry.status}: ${entry.count}`),
    '',
    `Custom fields: ${inventory.customFields.length}`,
    ...inventory.customFields.slice(0, 25).map((field) => {
      const type = field.dataType ? `, ${field.dataType}` : '';
      const model = field.model ? `, ${field.model}` : '';
      return `• ${field.name} (${field.fieldKey}${type}${model})`;
    }),
    inventory.customFields.length > 25
      ? `…and ${inventory.customFields.length - 25} more custom fields`
      : '',
  ];

  return lines.filter(Boolean).join('\n');
}
