import { randomUUID } from 'node:crypto';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
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

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [jobId, 'system', 'scheduled', JSON.stringify({ name: 'heartbeat' }), 'running', null],
  );

  const channel = process.env.SLACK_ALERTS_CHANNEL ?? '#ops-manager-alerts';
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

    await query(
      `UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`,
      ['succeeded', JSON.stringify(output), jobId],
    );

    log.info({ output }, 'Heartbeat job succeeded');
  } catch (err) {
    const errorPayload = {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error',
    };

    await query(
      `UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`,
      ['failed', JSON.stringify(errorPayload), jobId],
    );

    log.error({ err }, 'Heartbeat job failed');
    throw err;
  }
}
