import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js'
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { formatQaFleetSummaryOutput } from '../skills/qa/list-fleet-failures.js';
import { postMessageInputSchema, type PostMessageOutput } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';
import type { FleetQaSummary, FetchFleetQaSummaryInput } from '../lib/qa/fleet-summary.js';

export const QA_FLEET_SUMMARY_QUEUE = 'qa-fleet-summary';

export function isQaFleetSummaryEnabled(): boolean {
  return process.env.QA_FLEET_SUMMARY_ENABLED?.toLowerCase() === 'true';
}

export function getQaFleetSummaryCron(): string {
  return process.env.QA_FLEET_SUMMARY_CRON ?? '0 15 * * *';
}

export function getQaFleetSummaryWindowHours(): number {
  const configured = Number(process.env.QA_FLEET_SUMMARY_HOURS ?? 24);
  if (!Number.isFinite(configured)) {
    return 24;
  }
  return Math.min(Math.max(Math.trunc(configured), 1), 168);
}

export async function runQaFleetSummary(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const sinceHours = getQaFleetSummaryWindowHours();

  log.info({ sinceHours }, 'QA fleet summary job starting');

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'qa-review',
      trigger_type: 'scheduled',
      trigger_payload: JSON.stringify({ name: 'qa-fleet-summary' }),
      status: 'running',
      input: JSON.stringify({ sinceHours }),
      started_at: new Date(),
    },
  });

  const ctx: SkillContext = {
    jobId,
    agentId: 'qa-review',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const summarySkill = registry.get('qa.list-fleet-failures') as Skill<
      FetchFleetQaSummaryInput,
      FleetQaSummary
    >;
    const output = await summarySkill.execute({ sinceHours }, ctx);
    let slackTs: string | undefined;

    if (output.failedReviews > 0) {
      const channel = resolveChannel(
        [
          process.env.QA_FLEET_SUMMARY_CHANNEL,
          process.env.QA_REVIEW_SLACK_CHANNEL,
          process.env.SLACK_ALERTS_CHANNEL,
        ],
        '#ops-manager-alerts',
      );
      const postSkill = registry.get('slack.post-message');
      const post = (await postSkill.execute(
        postMessageInputSchema.parse({
          channel,
          text: formatQaFleetSummaryOutput(output),
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
          failedReviews: output.failedReviews,
          passRate: output.passRate,
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
        failedReviews: output.failedReviews,
        postedToSlack: slackTs !== undefined,
      },
      'QA fleet summary job succeeded',
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

    log.error({ err }, 'QA fleet summary job failed');
    throw err;
  }
}
