import type { Worker } from 'bullmq';
import { getQueue, getWorker } from '../lib/queue/client.js';
import { logger } from '../lib/logger.js';
import type { SkillRegistry } from '../skills/_registry.js';
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
}
