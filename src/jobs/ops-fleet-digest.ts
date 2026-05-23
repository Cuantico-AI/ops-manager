import { randomUUID } from 'node:crypto';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import type { FetchOpsFleetDigestInput, OpsFleetDigestSummary } from '../lib/ops/fleet-digest.js';
import { formatOpsFleetDigestOutput } from '../skills/ops/fleet-digest.js';
import {
  postMessageInputSchema,
  type PostMessageInput,
  type PostMessageOutput,
} from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const OPS_FLEET_DIGEST_QUEUE = 'ops-fleet-digest';

export function isOpsFleetDigestEnabled(): boolean {
  return process.env.OPS_FLEET_DIGEST_ENABLED?.toLowerCase() === 'true';
}

export function getOpsFleetDigestCron(): string {
  return process.env.OPS_FLEET_DIGEST_CRON ?? '30 16 * * *';
}

export function getOpsFleetDigestWindowHours(): number {
  const configured = Number(process.env.OPS_FLEET_DIGEST_HOURS ?? 24);
  if (!Number.isFinite(configured)) {
    return 24;
  }
  return Math.min(Math.max(Math.trunc(configured), 1), 168);
}

export async function runOpsFleetDigest(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const sinceHours = getOpsFleetDigestWindowHours();

  log.info({ sinceHours }, 'Ops fleet digest job starting');

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'ops-digest',
      'scheduled',
      JSON.stringify({ name: 'ops-fleet-digest' }),
      'running',
      JSON.stringify({ sinceHours }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'ops-digest',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const digestSkill = registry.get('ops.fleet-digest') as Skill<
      FetchOpsFleetDigestInput,
      OpsFleetDigestSummary
    >;
    const output = await digestSkill.execute({ sinceHours }, ctx);
    let slackTs: string | undefined;

    if (output.totalAttentionSignals > 0) {
      const channel =
        process.env.OPS_FLEET_DIGEST_CHANNEL ??
        process.env.SLACK_ALERTS_CHANNEL ??
        '#ops-manager-alerts';
      const postSkill = registry.get('slack.post-message') as Skill<
        PostMessageInput,
        PostMessageOutput
      >;
      const post = await postSkill.execute(
        postMessageInputSchema.parse({
          channel,
          text: formatOpsFleetDigestOutput(output),
        }),
        ctx,
      );
      slackTs = post.ts;
    }

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        sinceHours: output.sinceHours,
        totalAttentionSignals: output.totalAttentionSignals,
        accountsWithAttention: output.accountsWithAttention,
        multiSignalAccounts: output.multiSignalAccounts.length,
        postedToSlack: slackTs !== undefined,
        slackTs,
      }),
      jobId,
    ]);

    log.info(
      {
        sinceHours: output.sinceHours,
        totalAttentionSignals: output.totalAttentionSignals,
        accountsWithAttention: output.accountsWithAttention,
        postedToSlack: slackTs !== undefined,
      },
      'Ops fleet digest job succeeded',
    );
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

    log.error({ err }, 'Ops fleet digest job failed');
    throw err;
  }
}
