import { Queue, Worker, type Job, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../logger.js';

let connection: Redis | null = null;
const queues = new Map<string, Queue>();
const workers: Worker[] = [];

function getConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    connection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getConnection() });
    queues.set(name, queue);
  }
  return queue;
}

export function getWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
): Worker<T> {
  const worker = new Worker<T>(name, processor, {
    connection: getConnection(),
  });
  worker.on('failed', (job: Job<T> | undefined, err: Error) => {
    logger.error({ err, jobId: job?.id, queue: name }, 'Queue job failed');
  });
  workers.push(worker);
  return worker;
}

export async function closeQueue(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
