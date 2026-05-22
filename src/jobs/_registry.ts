import type { Worker } from 'bullmq';
import { isFleetDailyHealthEnabled } from '../lib/health/fleet-daily-summary.js';
import { getQueue, getWorker } from '../lib/queue/client.js';
import { logger } from '../lib/logger.js';
import type { SkillRegistry } from '../skills/_registry.js';
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

let heartbeatWorker: Worker | null = null;
let ghlTokenHealthWorker: Worker | null = null;
let ghlPipelineSnapshotWorker: Worker | null = null;
let ghlConfigInventoryWorker: Worker | null = null;
let assistableOAuthHealthWorker: Worker | null = null;
let n8nWorkflowHealthWorker: Worker | null = null;
let fleetDailyHealthWorker: Worker | null = null;

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
}
