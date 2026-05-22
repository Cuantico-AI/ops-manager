import { randomUUID } from 'node:crypto';
import { listAccountsForGhlTokenCheck } from '../lib/accounts/ghl-token-health.js';
import { fetchGhlAccountInventory } from '../lib/ghl/fetch-account-inventory.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { postMessageInputSchema } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { SkillContext } from '../skills/_types.js';

export const GHL_CONFIG_INVENTORY_QUEUE = 'ghl-config-inventory';

const DEFAULT_CONCURRENCY = 3;

export function getGhlConfigInventoryCron(): string {
  return process.env.GHL_CONFIG_INVENTORY_CRON ?? '0 15 1 * *';
}

export function formatGhlConfigFleetSummary(
  rows: Array<{
    accountName: string;
    workflowCount: number;
    publishedWorkflows: number;
    customFieldCount: number;
  }>,
  errors: Array<{ accountName: string; message: string }>,
): string {
  const sorted = [...rows].sort((left, right) => right.customFieldCount - left.customFieldCount);
  const totalWorkflows = rows.reduce((sum, row) => sum + row.workflowCount, 0);
  const totalFields = rows.reduce((sum, row) => sum + row.customFieldCount, 0);

  return [
    'Monthly GHL config inventory.',
    `Accounts checked: ${rows.length}`,
    `Total workflows: ${totalWorkflows}`,
    `Total custom fields: ${totalFields}`,
    sorted.length ? '' : undefined,
    ...sorted.slice(0, 15).map(
      (row) =>
        `• ${row.accountName} — ${row.workflowCount} workflows (${row.publishedWorkflows} published), ${row.customFieldCount} custom fields`,
    ),
    sorted.length > 15 ? `…and ${sorted.length - 15} more accounts` : undefined,
    errors.length ? '' : undefined,
    errors.length ? `Errors: ${errors.length}` : undefined,
    ...errors.slice(0, 10).map((error) => `• ${error.accountName} — ${error.message}`),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runGhlConfigInventory(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });

  log.info('GHL config inventory job starting');

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'scheduled',
      JSON.stringify({ name: 'ghl-config-inventory' }),
      'running',
      JSON.stringify({ includeInactive: false }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const accounts = await listAccountsForGhlTokenCheck({ includeInactive: false });
    const rows: Array<{
      accountName: string;
      workflowCount: number;
      publishedWorkflows: number;
      customFieldCount: number;
    }> = [];
    const errors: Array<{ accountName: string; message: string }> = [];
    let index = 0;

    async function worker(): Promise<void> {
      while (index < accounts.length) {
        const account = accounts[index];
        index += 1;
        if (!account || !account.ghlLocationId || !account.ghlPitTokenRef) {
          continue;
        }

        try {
          const inventory = await fetchGhlAccountInventory(account);
          rows.push({
            accountName: inventory.accountName,
            workflowCount: inventory.workflows.length,
            publishedWorkflows: inventory.workflows.filter(
              (workflow) => workflow.status.toLowerCase() === 'published',
            ).length,
            customFieldCount: inventory.customFields.length,
          });
        } catch (err) {
          errors.push({
            accountName: account.name,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(DEFAULT_CONCURRENCY, accounts.length) }, () => worker()),
    );

    const channel = process.env.SLACK_ALERTS_CHANNEL ?? '#ops-manager-alerts';
    const postSkill = registry.get('slack.post-message');
    const postInput = postMessageInputSchema.parse({
      channel,
      text: formatGhlConfigFleetSummary(rows, errors),
    });
    await postSkill.execute(postInput, ctx);

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        accountsChecked: rows.length,
        errors: errors.length,
        totalWorkflows: rows.reduce((sum, row) => sum + row.workflowCount, 0),
        totalCustomFields: rows.reduce((sum, row) => sum + row.customFieldCount, 0),
      }),
      jobId,
    ]);

    log.info({ accountsChecked: rows.length, errors: errors.length }, 'GHL config inventory succeeded');
  } catch (err) {
    const errorPayload = {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error',
    };

    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify(errorPayload),
      jobId,
    ]);

    log.error({ err }, 'GHL config inventory job failed');
    throw err;
  }
}
