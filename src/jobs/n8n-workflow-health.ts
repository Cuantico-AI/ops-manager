import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { shouldPostIndividualHealthAlert } from './health-alerts.js';
import { formatN8nWorkflowCheckSummary } from '../slack/commands.js';
import {
  checkN8nWorkflowHealthInputSchema,
  type CheckN8nWorkflowHealthInput,
  type CheckN8nWorkflowHealthOutput,
} from '../skills/n8n/check-workflow-health.js';
import { postMessageInputSchema } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const N8N_WORKFLOW_HEALTH_QUEUE = 'n8n-workflow-health';

export function getN8nWorkflowHealthCron(): string {
  return process.env.N8N_WORKFLOW_HEALTH_CRON ?? '45 13 * * *';
}

export async function runN8nWorkflowHealth(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  log.info('n8n workflow health job starting');

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'system',
      trigger_type: 'scheduled',
      trigger_payload: JSON.stringify({ name: 'n8n-workflow-health' }),
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
    const checkSkill = registry.get('n8n.check-workflow-health') as Skill<
      CheckN8nWorkflowHealthInput,
      CheckN8nWorkflowHealthOutput
    >;
    const checkInput = checkN8nWorkflowHealthInputSchema.parse({ includeInactive: false });
    const output = await checkSkill.execute(checkInput, ctx);

    if (shouldPostIndividualHealthAlert()) {
      const channel = resolveChannel([process.env.SLACK_ALERTS_CHANNEL], '#ops-manager-alerts');
      const postSkill = registry.get('slack.post-message');
      const postInput = postMessageInputSchema.parse({
        channel,
        text: formatN8nWorkflowCheckSummary(output),
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

    log.info({ summary: output.summary }, 'n8n workflow health job succeeded');
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

    log.error({ err }, 'n8n workflow health job failed');
    throw err;
  }
}