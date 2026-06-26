import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { SkillContext } from '../skills/_types.js';
import { postMessageInputSchema } from '../skills/slack/post-message.js';

export const HEARTBEAT_QUEUE = 'heartbeat';

export function getHeartbeatCron(): string {
  return process.env.HEARTBEAT_CRON ?? '0 * * * *';
}

export async function runHeartbeat(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  log.info('Heartbeat job starting');

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'system',
      trigger_type: 'scheduled',
      trigger_payload: JSON.stringify({ name: 'heartbeat' }),
      status: 'running',
      input: undefined,
      started_at: new Date(),
    },
  });

  const channel = resolveChannel([process.env.SLACK_ALERTS_CHANNEL], '#ops-manager-alerts');
  const text = `ops-manager alive — ${new Date().toISOString()}`;
  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const skill = registry.get('slack.post-message');
    const input = postMessageInputSchema.parse({ channel, text });
    const output = await skill.execute(input, ctx);

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify(output),
        completed_at: new Date(),
      },
    });

    log.info({ output }, 'Heartbeat job succeeded');
  } catch (err) {
    const errorPayload = {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error',
    };

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: JSON.stringify(errorPayload),
        completed_at: new Date(),
      },
    });

    log.error({ err }, 'Heartbeat job failed');
    throw err;
  }
}