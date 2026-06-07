import type { Worker } from 'bullmq';
import { isFleetDailyHealthEnabled } from '../lib/health/fleet-daily-summary.js';
import { getQueue, getWorker } from '../lib/queue/client.js';
import { logger } from '../lib/logger.js';
import type { SkillRegistry } from '../skills/_registry.js';
import {
  CLIENT_CHECKIN_ATTENTION_SWEEP_QUEUE,
  getClientCheckinAttentionSweepCron,
  isClientCheckinAttentionSweepEnabled,
  runClientCheckinAttentionSweep,
} from './client-checkin-attention-sweep.js';
import {
  CLIENT_CHECKIN_FLEET_SUMMARY_QUEUE,
  getClientCheckinFleetSummaryCron,
  isClientCheckinFleetSummaryEnabled,
  runClientCheckinFleetSummary,
} from './client-checkin-fleet-summary.js';
import {
  CLIENT_CHECKIN_FLEET_SWEEP_QUEUE,
  getClientCheckinFleetSweepCron,
  isClientCheckinFleetSweepEnabled,
  runClientCheckinFleetSweep,
} from './client-checkin-fleet-sweep.js';
import {
  getFleetDailyHealthCron,
  FLEET_DAILY_HEALTH_QUEUE,
  runFleetDailyHealth,
} from './fleet-daily-health.js';
import {
  getN8nWorkflowHealthCron,
  N8N_WORKFLOW_HEALTH_QUEUE,
  runN8nWorkflowHealth,
} from './n8n-workflow-health.js';
import {
  getQaFleetSummaryCron,
  isQaFleetSummaryEnabled,
  QA_FLEET_SUMMARY_QUEUE,
  runQaFleetSummary,
} from './qa-fleet-summary.js';
import {
  getPromptOpsFleetSummaryCron,
  isPromptOpsFleetSummaryEnabled,
  PROMPT_OPS_FLEET_SUMMARY_QUEUE,
  runPromptOpsFleetSummary,
} from './prompt-ops-fleet-summary.js';
import {
  getOpsFleetDigestCron,
  isOpsFleetDigestEnabled,
  OPS_FLEET_DIGEST_QUEUE,
  runOpsFleetDigest,
} from './ops-fleet-digest.js';
import {
  getOpsAccountAttentionRunCron,
  isOpsAccountAttentionRunEnabled,
  OPS_ACCOUNT_ATTENTION_RUN_QUEUE,
  runOpsAccountAttentionRun,
} from './ops-account-attention-run.js';
import {
  getAssistableOAuthHealthCron,
  ASSISTABLE_OAUTH_HEALTH_QUEUE,
  runAssistableOAuthHealth,
} from './assistable-oauth-health.js';
import {
  getGhlConfigInventoryCron,
  GHL_CONFIG_INVENTORY_QUEUE,
  runGhlConfigInventory,
} from './ghl-config-inventory.js';
import {
  getGhlPipelineSnapshotCron,
  GHL_PIPELINE_SNAPSHOT_QUEUE,
  runGhlPipelineSnapshot,
} from './ghl-pipeline-snapshot.js';
import {
  getGhlTokenHealthCron,
  GHL_TOKEN_HEALTH_QUEUE,
  runGhlTokenHealth,
} from './ghl-token-health.js';
import { getHeartbeatCron, HEARTBEAT_QUEUE, runHeartbeat } from './heartbeat.js';
import {
  ACCOUNT_ROLLUPS_QUEUE,
  getAccountRollupsCron,
  runAccountRollups,
} from './account-rollups.js';

let heartbeatWorker: Worker | null = null;
let ghlTokenHealthWorker: Worker | null = null;
let ghlPipelineSnapshotWorker: Worker | null = null;
let ghlConfigInventoryWorker: Worker | null = null;
let assistableOAuthHealthWorker: Worker | null = null;
let n8nWorkflowHealthWorker: Worker | null = null;
let fleetDailyHealthWorker: Worker | null = null;
let qaFleetSummaryWorker: Worker | null = null;
let clientCheckinAttentionSweepWorker: Worker | null = null;
let clientCheckinFleetSweepWorker: Worker | null = null;
let clientCheckinFleetSummaryWorker: Worker | null = null;
let promptOpsFleetSummaryWorker: Worker | null = null;
let opsFleetDigestWorker: Worker | null = null;
let opsAccountAttentionRunWorker: Worker | null = null;
let accountRollupsWorker: Worker | null = null;

export async function registerScheduledJobs(registry: SkillRegistry): Promise<void> {
  const heartbeatQueue = getQueue(HEARTBEAT_QUEUE);
  const heartbeatCron = getHeartbeatCron();

  await heartbeatQueue.obliterate({ force: true });
  await heartbeatQueue.add(
    'heartbeat-tick',
    {},
    {
      repeat: { pattern: heartbeatCron },
      jobId: 'heartbeat-repeatable',
    },
  );

  logger.info({ cron: heartbeatCron, queue: HEARTBEAT_QUEUE }, 'Registered heartbeat cron job');

  heartbeatWorker = getWorker(HEARTBEAT_QUEUE, async () => {
    await runHeartbeat(registry);
  });

  // Account daily rollups (activity sparkline + QA trend). Always on — it is
  // deterministic plumbing with no external dependency. Register the worker
  // first, then enqueue an immediate backfill so the rollup tables are populated
  // before the first cron tick, plus the repeatable schedule.
  const accountRollupsQueue = getQueue(ACCOUNT_ROLLUPS_QUEUE);
  const accountRollupsCron = getAccountRollupsCron();

  accountRollupsWorker = getWorker(ACCOUNT_ROLLUPS_QUEUE, async () => {
    await runAccountRollups();
  });

  await accountRollupsQueue.obliterate({ force: true });
  await accountRollupsQueue.add('account-rollups-initial', {});
  await accountRollupsQueue.add(
    'account-rollups-tick',
    {},
    {
      repeat: { pattern: accountRollupsCron },
      jobId: 'account-rollups-repeatable',
    },
  );

  logger.info(
    { cron: accountRollupsCron, queue: ACCOUNT_ROLLUPS_QUEUE },
    'Registered account rollups cron job',
  );

  if (isFleetDailyHealthEnabled()) {
    const fleetDailyHealthQueue = getQueue(FLEET_DAILY_HEALTH_QUEUE);
    const fleetDailyHealthCron = getFleetDailyHealthCron();

    await fleetDailyHealthQueue.obliterate({ force: true });
    await fleetDailyHealthQueue.add(
      'fleet-daily-health-tick',
      {},
      {
        repeat: { pattern: fleetDailyHealthCron },
        jobId: 'fleet-daily-health-repeatable',
      },
    );

    logger.info(
      { cron: fleetDailyHealthCron, queue: FLEET_DAILY_HEALTH_QUEUE },
      'Registered fleet daily health cron job',
    );

    fleetDailyHealthWorker = getWorker(FLEET_DAILY_HEALTH_QUEUE, async () => {
      await runFleetDailyHealth(registry);
    });
  } else {
    const ghlTokenHealthQueue = getQueue(GHL_TOKEN_HEALTH_QUEUE);
    const ghlTokenHealthCron = getGhlTokenHealthCron();

    await ghlTokenHealthQueue.obliterate({ force: true });
    await ghlTokenHealthQueue.add(
      'ghl-token-health-tick',
      {},
      {
        repeat: { pattern: ghlTokenHealthCron },
        jobId: 'ghl-token-health-repeatable',
      },
    );

    logger.info(
      { cron: ghlTokenHealthCron, queue: GHL_TOKEN_HEALTH_QUEUE },
      'Registered GHL token health cron job',
    );

    ghlTokenHealthWorker = getWorker(GHL_TOKEN_HEALTH_QUEUE, async () => {
      await runGhlTokenHealth(registry);
    });

    const assistableOAuthHealthQueue = getQueue(ASSISTABLE_OAUTH_HEALTH_QUEUE);
    const assistableOAuthHealthCron = getAssistableOAuthHealthCron();

    await assistableOAuthHealthQueue.obliterate({ force: true });
    await assistableOAuthHealthQueue.add(
      'assistable-oauth-health-tick',
      {},
      {
        repeat: { pattern: assistableOAuthHealthCron },
        jobId: 'assistable-oauth-health-repeatable',
      },
    );

    logger.info(
      { cron: assistableOAuthHealthCron, queue: ASSISTABLE_OAUTH_HEALTH_QUEUE },
      'Registered Assistable OAuth health cron job',
    );

    assistableOAuthHealthWorker = getWorker(ASSISTABLE_OAUTH_HEALTH_QUEUE, async () => {
      await runAssistableOAuthHealth(registry);
    });

    const n8nWorkflowHealthQueue = getQueue(N8N_WORKFLOW_HEALTH_QUEUE);
    const n8nWorkflowHealthCron = getN8nWorkflowHealthCron();

    await n8nWorkflowHealthQueue.obliterate({ force: true });
    await n8nWorkflowHealthQueue.add(
      'n8n-workflow-health-tick',
      {},
      {
        repeat: { pattern: n8nWorkflowHealthCron },
        jobId: 'n8n-workflow-health-repeatable',
      },
    );

    logger.info(
      { cron: n8nWorkflowHealthCron, queue: N8N_WORKFLOW_HEALTH_QUEUE },
      'Registered n8n workflow health cron job',
    );

    n8nWorkflowHealthWorker = getWorker(N8N_WORKFLOW_HEALTH_QUEUE, async () => {
      await runN8nWorkflowHealth(registry);
    });
  }

  if (isQaFleetSummaryEnabled()) {
    const qaFleetSummaryQueue = getQueue(QA_FLEET_SUMMARY_QUEUE);
    const qaFleetSummaryCron = getQaFleetSummaryCron();

    await qaFleetSummaryQueue.obliterate({ force: true });
    await qaFleetSummaryQueue.add(
      'qa-fleet-summary-tick',
      {},
      {
        repeat: { pattern: qaFleetSummaryCron },
        jobId: 'qa-fleet-summary-repeatable',
      },
    );

    logger.info(
      { cron: qaFleetSummaryCron, queue: QA_FLEET_SUMMARY_QUEUE },
      'Registered QA fleet summary cron job',
    );

    qaFleetSummaryWorker = getWorker(QA_FLEET_SUMMARY_QUEUE, async () => {
      await runQaFleetSummary(registry);
    });
  }

  if (isClientCheckinFleetSweepEnabled()) {
    const clientCheckinFleetSweepQueue = getQueue(CLIENT_CHECKIN_FLEET_SWEEP_QUEUE);
    const clientCheckinFleetSweepCron = getClientCheckinFleetSweepCron();

    await clientCheckinFleetSweepQueue.obliterate({ force: true });
    await clientCheckinFleetSweepQueue.add(
      'client-checkin-fleet-sweep-tick',
      {},
      {
        repeat: { pattern: clientCheckinFleetSweepCron },
        jobId: 'client-checkin-fleet-sweep-repeatable',
      },
    );

    logger.info(
      {
        cron: clientCheckinFleetSweepCron,
        queue: CLIENT_CHECKIN_FLEET_SWEEP_QUEUE,
      },
      'Registered client check-in fleet sweep cron job',
    );

    clientCheckinFleetSweepWorker = getWorker(CLIENT_CHECKIN_FLEET_SWEEP_QUEUE, async () => {
      await runClientCheckinFleetSweep(registry);
    });
  }

  if (isClientCheckinAttentionSweepEnabled()) {
    const clientCheckinAttentionSweepQueue = getQueue(CLIENT_CHECKIN_ATTENTION_SWEEP_QUEUE);
    const clientCheckinAttentionSweepCron = getClientCheckinAttentionSweepCron();

    await clientCheckinAttentionSweepQueue.obliterate({ force: true });
    await clientCheckinAttentionSweepQueue.add(
      'client-checkin-attention-sweep-tick',
      {},
      {
        repeat: { pattern: clientCheckinAttentionSweepCron },
        jobId: 'client-checkin-attention-sweep-repeatable',
      },
    );

    logger.info(
      {
        cron: clientCheckinAttentionSweepCron,
        queue: CLIENT_CHECKIN_ATTENTION_SWEEP_QUEUE,
      },
      'Registered client check-in attention sweep cron job',
    );

    clientCheckinAttentionSweepWorker = getWorker(CLIENT_CHECKIN_ATTENTION_SWEEP_QUEUE, async () => {
      await runClientCheckinAttentionSweep(registry);
    });
  }

  if (isClientCheckinFleetSummaryEnabled()) {
    const clientCheckinFleetSummaryQueue = getQueue(CLIENT_CHECKIN_FLEET_SUMMARY_QUEUE);
    const clientCheckinFleetSummaryCron = getClientCheckinFleetSummaryCron();

    await clientCheckinFleetSummaryQueue.obliterate({ force: true });
    await clientCheckinFleetSummaryQueue.add(
      'client-checkin-fleet-summary-tick',
      {},
      {
        repeat: { pattern: clientCheckinFleetSummaryCron },
        jobId: 'client-checkin-fleet-summary-repeatable',
      },
    );

    logger.info(
      {
        cron: clientCheckinFleetSummaryCron,
        queue: CLIENT_CHECKIN_FLEET_SUMMARY_QUEUE,
      },
      'Registered client check-in fleet summary cron job',
    );

    clientCheckinFleetSummaryWorker = getWorker(CLIENT_CHECKIN_FLEET_SUMMARY_QUEUE, async () => {
      await runClientCheckinFleetSummary(registry);
    });
  }

  if (isPromptOpsFleetSummaryEnabled()) {
    const promptOpsFleetSummaryQueue = getQueue(PROMPT_OPS_FLEET_SUMMARY_QUEUE);
    const promptOpsFleetSummaryCron = getPromptOpsFleetSummaryCron();

    await promptOpsFleetSummaryQueue.obliterate({ force: true });
    await promptOpsFleetSummaryQueue.add(
      'prompt-ops-fleet-summary-tick',
      {},
      {
        repeat: { pattern: promptOpsFleetSummaryCron },
        jobId: 'prompt-ops-fleet-summary-repeatable',
      },
    );

    logger.info(
      {
        cron: promptOpsFleetSummaryCron,
        queue: PROMPT_OPS_FLEET_SUMMARY_QUEUE,
      },
      'Registered Prompt Ops fleet summary cron job',
    );

    promptOpsFleetSummaryWorker = getWorker(PROMPT_OPS_FLEET_SUMMARY_QUEUE, async () => {
      await runPromptOpsFleetSummary(registry);
    });
  }

  if (isOpsFleetDigestEnabled()) {
    const opsFleetDigestQueue = getQueue(OPS_FLEET_DIGEST_QUEUE);
    const opsFleetDigestCron = getOpsFleetDigestCron();

    await opsFleetDigestQueue.obliterate({ force: true });
    await opsFleetDigestQueue.add(
      'ops-fleet-digest-tick',
      {},
      {
        repeat: { pattern: opsFleetDigestCron },
        jobId: 'ops-fleet-digest-repeatable',
      },
    );

    logger.info(
      {
        cron: opsFleetDigestCron,
        queue: OPS_FLEET_DIGEST_QUEUE,
      },
      'Registered Ops fleet digest cron job',
    );

    opsFleetDigestWorker = getWorker(OPS_FLEET_DIGEST_QUEUE, async () => {
      await runOpsFleetDigest(registry);
    });
  }

  if (isOpsAccountAttentionRunEnabled()) {
    const opsAccountAttentionRunQueue = getQueue(OPS_ACCOUNT_ATTENTION_RUN_QUEUE);
    const opsAccountAttentionRunCron = getOpsAccountAttentionRunCron();

    await opsAccountAttentionRunQueue.obliterate({ force: true });
    await opsAccountAttentionRunQueue.add(
      'ops-account-attention-run-tick',
      {},
      {
        repeat: { pattern: opsAccountAttentionRunCron },
        jobId: 'ops-account-attention-run-repeatable',
      },
    );

    logger.info(
      {
        cron: opsAccountAttentionRunCron,
        queue: OPS_ACCOUNT_ATTENTION_RUN_QUEUE,
      },
      'Registered Ops account attention run cron job',
    );

    opsAccountAttentionRunWorker = getWorker(OPS_ACCOUNT_ATTENTION_RUN_QUEUE, async () => {
      await runOpsAccountAttentionRun(registry);
    });
  }

  const ghlPipelineSnapshotQueue = getQueue(GHL_PIPELINE_SNAPSHOT_QUEUE);
  const ghlPipelineSnapshotCron = getGhlPipelineSnapshotCron();

  await ghlPipelineSnapshotQueue.obliterate({ force: true });
  await ghlPipelineSnapshotQueue.add(
    'ghl-pipeline-snapshot-tick',
    {},
    {
      repeat: { pattern: ghlPipelineSnapshotCron },
      jobId: 'ghl-pipeline-snapshot-repeatable',
    },
  );

  logger.info(
    { cron: ghlPipelineSnapshotCron, queue: GHL_PIPELINE_SNAPSHOT_QUEUE },
    'Registered GHL pipeline snapshot cron job',
  );

  ghlPipelineSnapshotWorker = getWorker(GHL_PIPELINE_SNAPSHOT_QUEUE, async () => {
    await runGhlPipelineSnapshot(registry);
  });

  const ghlConfigInventoryQueue = getQueue(GHL_CONFIG_INVENTORY_QUEUE);
  const ghlConfigInventoryCron = getGhlConfigInventoryCron();

  await ghlConfigInventoryQueue.obliterate({ force: true });
  await ghlConfigInventoryQueue.add(
    'ghl-config-inventory-tick',
    {},
    {
      repeat: { pattern: ghlConfigInventoryCron },
      jobId: 'ghl-config-inventory-repeatable',
    },
  );

  logger.info(
    { cron: ghlConfigInventoryCron, queue: GHL_CONFIG_INVENTORY_QUEUE },
    'Registered GHL config inventory cron job',
  );

  ghlConfigInventoryWorker = getWorker(GHL_CONFIG_INVENTORY_QUEUE, async () => {
    await runGhlConfigInventory(registry);
  });
}

export async function stopScheduledJobs(): Promise<void> {
  if (heartbeatWorker) {
    await heartbeatWorker.close();
    heartbeatWorker = null;
  }
  if (ghlTokenHealthWorker) {
    await ghlTokenHealthWorker.close();
    ghlTokenHealthWorker = null;
  }
  if (ghlPipelineSnapshotWorker) {
    await ghlPipelineSnapshotWorker.close();
    ghlPipelineSnapshotWorker = null;
  }
  if (ghlConfigInventoryWorker) {
    await ghlConfigInventoryWorker.close();
    ghlConfigInventoryWorker = null;
  }
  if (assistableOAuthHealthWorker) {
    await assistableOAuthHealthWorker.close();
    assistableOAuthHealthWorker = null;
  }
  if (n8nWorkflowHealthWorker) {
    await n8nWorkflowHealthWorker.close();
    n8nWorkflowHealthWorker = null;
  }
  if (fleetDailyHealthWorker) {
    await fleetDailyHealthWorker.close();
    fleetDailyHealthWorker = null;
  }
  if (qaFleetSummaryWorker) {
    await qaFleetSummaryWorker.close();
    qaFleetSummaryWorker = null;
  }
  if (clientCheckinFleetSweepWorker) {
    await clientCheckinFleetSweepWorker.close();
    clientCheckinFleetSweepWorker = null;
  }
  if (clientCheckinAttentionSweepWorker) {
    await clientCheckinAttentionSweepWorker.close();
    clientCheckinAttentionSweepWorker = null;
  }
  if (clientCheckinFleetSummaryWorker) {
    await clientCheckinFleetSummaryWorker.close();
    clientCheckinFleetSummaryWorker = null;
  }
  if (promptOpsFleetSummaryWorker) {
    await promptOpsFleetSummaryWorker.close();
    promptOpsFleetSummaryWorker = null;
  }
  if (opsFleetDigestWorker) {
    await opsFleetDigestWorker.close();
    opsFleetDigestWorker = null;
  }
  if (opsAccountAttentionRunWorker) {
    await opsAccountAttentionRunWorker.close();
    opsAccountAttentionRunWorker = null;
  }
  if (accountRollupsWorker) {
    await accountRollupsWorker.close();
    accountRollupsWorker = null;
  }
}
