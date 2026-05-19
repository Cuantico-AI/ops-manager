import type { Worker } from 'bullmq';
import { getQueue, getWorker } from '../lib/queue/client.js';
import { logger } from '../lib/logger.js';
import type { SkillRegistry } from '../skills/_registry.js';
import { getHeartbeatCron, HEARTBEAT_QUEUE, runHeartbeat } from './heartbeat.js';

let heartbeatWorker: Worker | null = null;

export async function registerScheduledJobs(registry: SkillRegistry): Promise<void> {
  const queue = getQueue(HEARTBEAT_QUEUE);
  const cron = getHeartbeatCron();

  await queue.obliterate({ force: true });
  await queue.add(
    'heartbeat-tick',
    {},
    {
      repeat: { pattern: cron },
      jobId: 'heartbeat-repeatable',
    },
  );

  logger.info({ cron, queue: HEARTBEAT_QUEUE }, 'Registered heartbeat cron job');

  heartbeatWorker = getWorker(HEARTBEAT_QUEUE, async () => {
    await runHeartbeat(registry);
  });
}

export async function stopScheduledJobs(): Promise<void> {
  if (heartbeatWorker) {
    await heartbeatWorker.close();
    heartbeatWorker = null;
  }
}
