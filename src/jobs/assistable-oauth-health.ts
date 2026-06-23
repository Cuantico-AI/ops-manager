import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { shouldPostIndividualHealthAlert } from './health-alerts.js';
import { formatAssistableOAuthCheckSummary } from '../slack/commands.js';
import {
  checkAssistableOAuthInputSchema,
  type CheckAssistableOAuthInput,
  type CheckAssistableOAuthOutput,
} from '../skills/assistable/check-oauth-status.js';
import {
  refreshAssistableOAuthInputSchema,
  type RefreshAssistableOAuthInput,
  type RefreshAssistableOAuthOutput,
} from '../skills/assistable/refresh-oauth.js';
import { postMessageInputSchema } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const ASSISTABLE_OAUTH_HEALTH_QUEUE = 'assistable-oauth-health';

export function getAssistableOAuthHealthCron(): string {
  return process.env.ASSISTABLE_OAUTH_HEALTH_CRON ?? '30 13 * * *';
}

export async function runAssistableOAuthHealth(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });

  log.info('Assistable OAuth health job starting');

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'scheduled',
      JSON.stringify({ name: 'assistable-oauth-health' }),
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
    const checkSkill = registry.get('assistable.check-oauth-status') as Skill<
      CheckAssistableOAuthInput,
      CheckAssistableOAuthOutput
    >;
    const checkInput = checkAssistableOAuthInputSchema.parse({ includeInactive: false });
    const output = await checkSkill.execute(checkInput, ctx);

    const eligibleForRefresh = output.results.filter(
      (r) => r.status === 'disconnected' || r.status === 'auth-error',
    );

    for (const result of eligibleForRefresh) {
      const refreshSkill = registry.get('assistable.refresh-oauth') as Skill<RefreshAssistableOAuthInput, RefreshAssistableOAuthOutput>;
      await refreshSkill.execute(
        refreshAssistableOAuthInputSchema.parse({ accountId: result.accountId }),
        ctx,
      );
    }

    if (shouldPostIndividualHealthAlert()) {
      const channel = resolveChannel([process.env.SLACK_ALERTS_CHANNEL], '#ops-manager-alerts');
      const postSkill = registry.get('slack.post-message');
      const postInput = postMessageInputSchema.parse({
        channel,
        text: formatAssistableOAuthCheckSummary(output),
      });
      await postSkill.execute(postInput, ctx);
    }

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);

    log.info({ summary: output.summary }, 'Assistable OAuth health job succeeded');
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

    log.error({ err }, 'Assistable OAuth health job failed');
    throw err;
  }
}
