import { randomUUID } from 'node:crypto';
import type { App } from '@slack/bolt';
import {
  listStoredAccounts,
  syncGoogleSheetRoster,
  type AccountSummary,
  type RosterSyncSummary,
} from '../lib/accounts/google-sheet-roster.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { llmClient } from '../lib/llm/client.js';
import {
  checkN8nWorkflowHealthInputSchema,
  n8nCheckWorkflowHealthSkill,
  type CheckN8nWorkflowHealthOutput,
} from '../skills/n8n/check-workflow-health.js';
import {
  checkAssistableOAuthInputSchema,
  assistableCheckOAuthStatusSkill,
  type CheckAssistableOAuthOutput,
} from '../skills/assistable/check-oauth-status.js';
import {
  checkPitTokenInputSchema,
  ghlCheckPitTokenSkill,
  type CheckPitTokenOutput,
} from '../skills/ghl/check-pit-token.js';
import { formatGhlAccountSnapshot } from '../lib/ghl/snapshot.js';
import { formatGhlAccountInventory } from '../lib/ghl/inventory.js';
import {
  ghlInventoryInputSchema,
  ghlInventorySkill,
  type GhlInventoryOutput,
} from '../skills/ghl/inventory.js';
import {
  ghlSnapshotInputSchema,
  ghlSnapshotSkill,
  type GhlSnapshotOutput,
} from '../skills/ghl/snapshot.js';
import type { SkillContext } from '../skills/_types.js';

const startTime = Date.now();

export function registerCommands(app: App): void {
  app.command('/ops', async ({ command, ack, respond }) => {
    await ack();

    const parts = command.text.trim().split(/\s+/).filter(Boolean);
    const subcommand = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1).join(' ');

    if (subcommand === 'ping' || subcommand === '') {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      await respond({
        response_type: 'ephemeral',
        text: `pong — uptime: ${uptimeSeconds}s`,
      });
      return;
    }

    if (subcommand === 'accounts') {
      const accounts = await listStoredAccounts();

      await respond({
        response_type: 'ephemeral',
        text: formatAccountsSummary(accounts),
      });
      return;
    }

    if (subcommand === 'sync-roster' || subcommand === 'roster-sync') {
      try {
        const { summary, accounts } = await syncGoogleSheetRoster();
        await respond({
          response_type: 'ephemeral',
          text: formatRosterSyncSummary(summary, accounts),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Roster sync failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'check-tokens' || subcommand === 'check-pit-tokens') {
      try {
        const output = await runManualGhlTokenCheck(args || undefined);
        await respond({
          response_type: 'ephemeral',
          text: formatGhlTokenCheckSummary(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `GHL token check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'check-assistable' || subcommand === 'check-assistable-oauth') {
      try {
        const output = await runManualAssistableOAuthCheck(args || undefined);
        await respond({
          response_type: 'ephemeral',
          text: formatAssistableOAuthCheckSummary(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Assistable OAuth check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'check-n8n' || subcommand === 'check-n8n-workflows') {
      try {
        const output = await runManualN8nWorkflowCheck(args || undefined);
        await respond({
          response_type: 'ephemeral',
          text: formatN8nWorkflowCheckSummary(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `n8n workflow check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'ghl-snapshot') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops ghl-snapshot <account name>',
        });
        return;
      }

      try {
        const snapshot = await runManualGhlSnapshot(args);
        await respond({
          response_type: 'ephemeral',
          text: formatGhlAccountSnapshot(snapshot),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `GHL snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'ghl-inventory') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops ghl-inventory <account name>',
        });
        return;
      }

      try {
        const inventory = await runManualGhlInventory(args);
        await respond({
          response_type: 'ephemeral',
          text: formatGhlAccountInventory(inventory),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `GHL inventory failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `Unknown subcommand: ${subcommand}. Try /ops ping, /ops accounts, /ops sync-roster, /ops check-tokens, /ops check-assistable, /ops check-n8n, /ops ghl-snapshot, or /ops ghl-inventory`,
    });
  });
}

export function formatAccountsSummary(accounts: AccountSummary[]): string {
  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const missingTokenCount = accounts.filter(
    (account) => account.pitTokenStatus === 'missing',
  ).length;

  return [
    `Known accounts: ${accounts.length} (${activeCount} active)`,
    `GHL PIT tokens missing: ${missingTokenCount}`,
    '',
    ...accounts.slice(0, 20).map((account) => {
      const token = account.pitTokenStatus === 'stored' ? 'token stored' : 'token missing';
      return `• ${account.name} — ${account.status}, ${token}`;
    }),
    accounts.length > 20 ? `…and ${accounts.length - 20} more` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatRosterSyncSummary(
  summary: RosterSyncSummary,
  accounts: AccountSummary[],
): string {
  const missingTokenCount = accounts.filter(
    (account) => account.pitTokenStatus === 'missing',
  ).length;

  return [
    'GHL roster sync complete.',
    `Rows read: ${summary.totalRows}`,
    `Inserted: ${summary.inserted}`,
    `Updated: ${summary.updated}`,
    `Encrypted PIT tokens stored: ${summary.tokensStored}`,
    `Token references set: ${summary.tokenRefsSet}`,
    `Known accounts: ${accounts.length}`,
    `GHL PIT tokens missing: ${missingTokenCount}`,
  ].join('\n');
}

export function formatGhlTokenCheckSummary(output: CheckPitTokenOutput): string {
  const attention = output.results.filter((result) => result.status !== 'valid');
  const onlyResult = output.results.length === 1 ? output.results[0] : undefined;

  if (onlyResult) {
    return [
      'GHL PIT token check complete.',
      `Account: ${onlyResult.accountName}`,
      `Status: ${onlyResult.status}`,
      `Location ID: ${onlyResult.ghlLocationId ?? 'missing'}`,
      `HTTP status: ${onlyResult.httpStatus ?? 'n/a'}`,
      `Token fingerprint: ${
        onlyResult.tokenFingerprint ? `sha256:${onlyResult.tokenFingerprint}` : 'n/a'
      }`,
      onlyResult.status === 'valid'
        ? 'Note: valid means this PIT can read the LeadConnector location endpoint; narrower endpoint scopes may still fail.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'GHL PIT token check complete.',
    `Checked: ${output.summary.total}`,
    `Valid: ${output.summary.valid}`,
    `Needs attention: ${output.summary.needsAttention}`,
    `Invalid: ${output.summary.invalid}`,
    `Forbidden/scope issue: ${output.summary.forbidden}`,
    `Location not found: ${output.summary.notFound}`,
    `Missing token: ${output.summary.missingToken}`,
    `Missing location: ${output.summary.missingLocation}`,
    `Secret errors: ${output.summary.secretError}`,
    `Unreachable: ${output.summary.unreachable}`,
    attention.length ? '' : 'All checked accounts are valid.',
    ...attention.slice(0, 20).map((result) => `• ${result.accountName} — ${result.status}`),
    attention.length > 20 ? `…and ${attention.length - 20} more needing attention` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAssistableOAuthCheckSummary(output: CheckAssistableOAuthOutput): string {
  const attention = output.results.filter((result) => result.status !== 'connected');
  const onlyResult = output.results.length === 1 ? output.results[0] : undefined;

  if (onlyResult) {
    return [
      'Assistable OAuth check complete.',
      `Account: ${onlyResult.accountName}`,
      `Status: ${onlyResult.status}`,
      `Assistable location ID: ${onlyResult.assistableLocationId ?? 'missing'}`,
      onlyResult.locationSource ? `Location source: ${onlyResult.locationSource}` : '',
      `HTTP status: ${onlyResult.httpStatus ?? 'n/a'}`,
      onlyResult.status === 'connected'
        ? 'Note: connected means Assistable sees a GHL access token for this location; a missing probe conversation is expected.'
        : '',
      onlyResult.message ? `Assistable message: ${onlyResult.message}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'Assistable OAuth check complete.',
    `Checked: ${output.summary.total}`,
    `Connected: ${output.summary.connected}`,
    `Needs attention: ${output.summary.needsAttention}`,
    `Disconnected: ${output.summary.disconnected}`,
    `Not found: ${output.summary.notFound}`,
    `Missing location ID: ${output.summary.missingSubaccountId}`,
    `Auth errors: ${output.summary.authError}`,
    `Unreachable: ${output.summary.unreachable}`,
    attention.length ? '' : 'All checked accounts are connected.',
    ...attention.slice(0, 20).map((result) => `• ${result.accountName} — ${result.status}`),
    attention.length > 20 ? `…and ${attention.length - 20} more needing attention` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatN8nWorkflowCheckSummary(output: CheckN8nWorkflowHealthOutput): string {
  const attention = output.results.filter((result) => result.status === 'needs-attention');
  const onlyResult = output.results.length === 1 ? output.results[0] : undefined;

  if (onlyResult) {
    if (onlyResult.status === 'missing-workflow-ids') {
      return [
        'n8n workflow check complete.',
        `Account: ${onlyResult.accountName}`,
        'Status: missing-workflow-ids',
        'No n8n workflow IDs are stored for this account in the roster.',
      ].join('\n');
    }

    return [
      'n8n workflow check complete.',
      `Account: ${onlyResult.accountName}`,
      `Status: ${onlyResult.status}`,
      ...onlyResult.workflows.map((workflow) => {
        const lastRun = workflow.lastRunAt ? `, last run ${workflow.lastRunAt}` : '';
        const errors =
          workflow.recentErrors > 0 ? `, ${workflow.recentErrors} recent error(s)` : '';
        return `• ${workflow.workflowName} (${workflow.workflowId}) — ${workflow.status}${lastRun}${errors}`;
      }),
    ].join('\n');
  }

  return [
    'n8n workflow check complete.',
    `Checked: ${output.summary.total}`,
    `Healthy: ${output.summary.healthy}`,
    `Needs attention: ${output.summary.needsAttention}`,
    `Missing workflow IDs: ${output.summary.missingWorkflowIds}`,
    `Failing workflows: ${output.summary.failingWorkflows}`,
    `Stale workflows: ${output.summary.staleWorkflows}`,
    `Inactive workflows: ${output.summary.inactiveWorkflows}`,
    `Not found: ${output.summary.notFoundWorkflows}`,
    `Unreachable: ${output.summary.unreachableWorkflows}`,
    attention.length ? '' : 'All checked accounts with n8n workflows are healthy.',
    ...attention.slice(0, 20).map((result) => {
      const badWorkflows = result.workflows.filter((workflow) =>
        ['failing', 'stale', 'not_found', 'unreachable'].includes(workflow.status),
      );
      const detail = badWorkflows
        .slice(0, 2)
        .map((workflow) => `${workflow.workflowName}: ${workflow.status}`)
        .join('; ');
      return `• ${result.accountName} — ${detail || result.status}`;
    }),
    attention.length > 20 ? `…and ${attention.length - 20} more needing attention` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function runManualN8nWorkflowCheck(
  accountQuery?: string,
): Promise<CheckN8nWorkflowHealthOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops check-n8n', accountQuery }),
      'running',
      JSON.stringify({ includeInactive: false, accountQuery }),
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
    const input = checkN8nWorkflowHealthInputSchema.parse({
      includeInactive: false,
      accountQuery,
    });
    const output = await n8nCheckWorkflowHealthSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualAssistableOAuthCheck(
  accountQuery?: string,
): Promise<CheckAssistableOAuthOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops check-assistable', accountQuery }),
      'running',
      JSON.stringify({ includeInactive: false, accountQuery }),
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
    const input = checkAssistableOAuthInputSchema.parse({
      includeInactive: false,
      accountQuery,
    });
    const output = await assistableCheckOAuthStatusSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualGhlTokenCheck(accountQuery?: string): Promise<CheckPitTokenOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops check-tokens', accountQuery }),
      'running',
      JSON.stringify({ includeInactive: false, accountQuery }),
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
    const input = checkPitTokenInputSchema.parse({ includeInactive: false, accountQuery });
    const output = await ghlCheckPitTokenSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualGhlInventory(accountQuery: string): Promise<GhlInventoryOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops ghl-inventory', accountQuery }),
      'running',
      JSON.stringify({ accountQuery }),
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
    const input = ghlInventoryInputSchema.parse({ accountQuery });
    const output = await ghlInventorySkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        workflowCount: output.workflows.length,
        customFieldCount: output.customFields.length,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualGhlSnapshot(accountQuery: string): Promise<GhlSnapshotOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops ghl-snapshot', accountQuery }),
      'running',
      JSON.stringify({ accountQuery }),
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
    const input = ghlSnapshotInputSchema.parse({ accountQuery });
    const output = await ghlSnapshotSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        pipelineCount: output.pipelines.length,
        totalOpportunities: output.totalOpportunities,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}
