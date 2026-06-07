import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
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

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'scheduled',
      JSON.stringify({ name: 'ghl-token-health' }),
      'running',
      JSON.stringify({ includeInactive: false }),
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

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);

    log.info({ summary: output.summary }, 'GHL token health job succeeded');
  } catch (err) {
    const errorPayload = {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error',
    };

    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify(errorPayload),
      jobId,
    ]);

    log.error({ err }, 'GHL token health job failed');
    throw err;
  }
}
