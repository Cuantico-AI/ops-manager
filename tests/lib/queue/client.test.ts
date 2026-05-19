import { expect, it } from 'vitest';
import { describeIntegration as describe } from '../../helpers.js';
import { getQueue, closeQueue } from '../../../src/lib/queue/client.js';

describe('queue client', () => {
  it('creates a named queue', async () => {
    const queue = getQueue('test-queue');
    expect(queue.name).toBe('test-queue');
    await closeQueue();
  });
});
