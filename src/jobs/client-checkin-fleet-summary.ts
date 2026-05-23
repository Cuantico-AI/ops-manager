import { randomUUID } from 'node:crypto';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { formatClientCheckinFleetSummaryOutput } from '../skills/client-checkin/list-fleet-risks.js';
import { postMessageInputSchema, type PostMessageOutput } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';
import type {
  ClientCheckinFleetSummary,
  FetchClientCheckinFleetSummaryInput,
} from '../lib/client-checkin/fleet-summary.js';

export const CLIENT_CHECKIN_FLEET_SUMMARY_QUEUE = 'client-checkin-fleet-summary';

export function isClientCheckinFleetSummaryEnabled(): boolean {
  return process.env.CLIENT_CHECKIN_FLEET_SUMMARY_ENABLED?.toLowerCase() === 'true';
}

export function getClientCheckinFleetSummaryCron(): string {
  return process.env.CLIENT_CHECKIN_FLEET_SUMMARY_CRON ?? '30 15 * * *';
}

export function getClientCheckinFleetSummaryWindowHours(): number {
  const configured = Number(process.env.CLIENT_CHECKIN_FLEET_SUMMARY_HOURS ?? 168);
  if (!Number.isFinite(configured)) {
    return 168;
  }
  return Math.min(Math.max(Math.trunc(configured), 1), 720);
}

export async function runClientCheckinFleetSummary(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const sinceHours = getClientCheckinFleetSummaryWindowHours();

  log.info({ sinceHours }, 'Client check-in fleet summary job starting');

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'client-checkin',
      'scheduled',
      JSON.stringify({ name: 'client-checkin-fleet-summary' }),
      'running',
      JSON.stringify({ sinceHours }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'client-checkin',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const summarySkill = registry.get('client-checkin.list-fleet-risks') as Skill<
      FetchClientCheckinFleetSummaryInput,
      ClientCheckinFleetSummary
    >;
    const output = await summarySkill.execute({ sinceHours }, ctx);
    let slackTs: string | undefined;

    if (output.attentionBriefs > 0) {
      const channel =
        process.env.CLIENT_CHECKIN_FLEET_SUMMARY_CHANNEL ??
        process.env.SLACK_ALERTS_CHANNEL ??
        '#ops-manager-alerts';
      const postSkill = registry.get('slack.post-message');
      const post = (await postSkill.execute(
        postMessageInputSchema.parse({
          channel,
          text: formatClientCheckinFleetSummaryOutput(output),
        }),
        ctx,
      )) as PostMessageOutput;
      slackTs = post.ts;
    }

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        sinceHours: output.sinceHours,
        totalBriefs: output.totalBriefs,
        attentionBriefs: output.attentionBriefs,
        attentionRate: output.attentionRate,
        postedToSlack: slackTs !== undefined,
        slackTs,
      }),
      jobId,
    ]);

    log.info(
      {
        sinceHours: output.sinceHours,
        totalBriefs: output.totalBriefs,
        attentionBriefs: output.attentionBriefs,
        postedToSlack: slackTs !== undefined,
      },
      'Client check-in fleet summary job succeeded',
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

    log.error({ err }, 'Client check-in fleet summary job failed');
    throw err;
  }
}
