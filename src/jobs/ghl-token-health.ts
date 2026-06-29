import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { shouldPostIndividualHealthAlert } from './health-alerts.js';
import { formatGhlTokenCheckSummary } from '../slack/commands.js';
import {
  checkPitTokenInputSchema,
  type CheckPitTokenInput,
  type CheckPitTokenOutput,
} from '../skills/ghl/check-pit-token.js';
import { postMessageInputSchema } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const GHL_TOKEN_HEALTH_QUEUE = 'ghl-token-health';

export function getGhlTokenHealthCron(): string {
  return process.env.GHL_TOKEN_HEALTH_CRON ?? '15 13 * * *';
}

export async function runGhlTokenHealth(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  log.info('GHL token health job starting');

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'system',
      trigger_type: 'scheduled',
      trigger_payload: JSON.stringify({ name: 'ghl-token-health' }),
      status: 'running',
      input: JSON.stringify({ includeInactive: false }),
      started_at: new Date(),
    },
  });

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const checkSkill = registry.get('ghl.check-pit-token') as Skill<
      CheckPitTokenInput,
      CheckPitTokenOutput
    >;
    const checkInput = checkPitTokenInputSchema.parse({ includeInactive: false });
    const output = await checkSkill.execute(checkInput, ctx);

    if (shouldPostIndividualHealthAlert()) {
      const channel = resolveChannel([process.env.SLACK_ALERTS_CHANNEL], '#ops-manager-alerts');
      const postSkill = registry.get('slack.post-message');
      const postInput = postMessageInputSchema.parse({
        channel,
        text: formatGhlTokenCheckSummary(output),
      });
      await postSkill.execute(postInput, ctx);
    }

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify({ summary: output.summary }),
        completed_at: new Date(),
      },
    });

    log.info({ summary: output.summary }, 'GHL token health job succeeded');
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

    log.error({ err }, 'GHL token health job failed');
    throw err;
  }
}