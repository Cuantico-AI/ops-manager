import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js'
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

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'prompt-ops',
      trigger_type: 'scheduled',
      trigger_payload: JSON.stringify({ name: 'prompt-ops-fleet-summary' }),
      status: 'running',
      input: JSON.stringify({ sinceHours }),
      started_at: new Date(),
    },
  });

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

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify({
          sinceHours: output.sinceHours,
          totalReviews: output.totalReviews,
          blockedReviews: output.blockedReviews,
          highRiskReviews: output.highRiskReviews,
          attentionReviews: output.attentionReviews,
          attentionRate: output.attentionRate,
          postedToSlack: slackTs !== undefined,
          slackTs,
        }),
        completed_at: new Date(),
      },
    });

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

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: JSON.stringify(errorPayload),
        completed_at: new Date(),
      },
    });

    log.error({ err }, 'Prompt Ops fleet summary job failed');
    throw err;
  }
}
