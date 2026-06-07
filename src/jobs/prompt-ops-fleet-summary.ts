import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import type {
  FetchPromptOpsFleetSummaryInput,
  PromptOpsFleetSummary,
} from '../lib/prompt-ops/fleet-summary.js';
import { formatPromptOpsFleetSummaryOutput } from '../skills/prompt-ops/list-fleet-risks.js';
import { postMessageInputSchema, type PostMessageOutput } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const PROMPT_OPS_FLEET_SUMMARY_QUEUE = 'prompt-ops-fleet-summary';

export function isPromptOpsFleetSummaryEnabled(): boolean {
  return process.env.PROMPT_OPS_FLEET_SUMMARY_ENABLED?.toLowerCase() === 'true';
}

export function getPromptOpsFleetSummaryCron(): string {
  return process.env.PROMPT_OPS_FLEET_SUMMARY_CRON ?? '0 16 * * *';
}

export function getPromptOpsFleetSummaryWindowHours(): number {
  const configured = Number(process.env.PROMPT_OPS_FLEET_SUMMARY_HOURS ?? 168);
  if (!Number.isFinite(configured)) {
    return 168;
  }
  return Math.min(Math.max(Math.trunc(configured), 1), 720);
}

export async function runPromptOpsFleetSummary(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const sinceHours = getPromptOpsFleetSummaryWindowHours();

  log.info({ sinceHours }, 'Prompt Ops fleet summary job starting');

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'prompt-ops',
      'scheduled',
      JSON.stringify({ name: 'prompt-ops-fleet-summary' }),
      'running',
      JSON.stringify({ sinceHours }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'prompt-ops',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const summarySkill = registry.get('prompt-ops.list-fleet-risks') as Skill<
      FetchPromptOpsFleetSummaryInput,
      PromptOpsFleetSummary
    >;
    const output = await summarySkill.execute({ sinceHours }, ctx);
    let slackTs: string | undefined;

    if (output.attentionReviews > 0) {
      const channel = resolveChannel(
        [process.env.PROMPT_OPS_FLEET_SUMMARY_CHANNEL, process.env.SLACK_ALERTS_CHANNEL],
        '#ops-manager-alerts',
      );
      const postSkill = registry.get('slack.post-message');
      const post = (await postSkill.execute(
        postMessageInputSchema.parse({
          channel,
          text: formatPromptOpsFleetSummaryOutput(output),
        }),
        ctx,
      )) as PostMessageOutput;
      slackTs = post.ts;
    }

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        sinceHours: output.sinceHours,
        totalReviews: output.totalReviews,
        blockedReviews: output.blockedReviews,
        highRiskReviews: output.highRiskReviews,
        attentionReviews: output.attentionReviews,
        attentionRate: output.attentionRate,
        postedToSlack: slackTs !== undefined,
        slackTs,
      }),
      jobId,
    ]);

    log.info(
      {
        sinceHours: output.sinceHours,
        totalReviews: output.totalReviews,
        attentionReviews: output.attentionReviews,
        postedToSlack: slackTs !== undefined,
      },
      'Prompt Ops fleet summary job succeeded',
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

    log.error({ err }, 'Prompt Ops fleet summary job failed');
    throw err;
  }
}
