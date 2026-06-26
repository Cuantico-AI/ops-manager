import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js';
import {
  formatFleetDailyHealthOverview,
  type FleetDailyHealthChecks,
} from '../lib/health/fleet-daily-summary.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import {
  formatAssistableOAuthCheckSummary,
  formatGhlTokenCheckSummary,
  formatN8nWorkflowCheckSummary,
} from '../slack/commands.js';
import {
  checkAssistableOAuthInputSchema,
  type CheckAssistableOAuthInput,
  type CheckAssistableOAuthOutput,
} from '../skills/assistable/check-oauth-status.js';
import {
  checkPitTokenInputSchema,
  type CheckPitTokenInput,
  type CheckPitTokenOutput,
} from '../skills/ghl/check-pit-token.js';
import {
  checkN8nWorkflowHealthInputSchema,
  type CheckN8nWorkflowHealthInput,
  type CheckN8nWorkflowHealthOutput,
} from '../skills/n8n/check-workflow-health.js';
import { postMessageInputSchema, type PostMessageOutput } from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const FLEET_DAILY_HEALTH_QUEUE = 'fleet-daily-health';

export function getFleetDailyHealthCron(): string {
  return process.env.FLEET_DAILY_HEALTH_CRON ?? '0 14 * * *';
}

export async function runFleetDailyHealth(registry: SkillRegistry): Promise<void> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });

  log.info('Fleet daily health job starting');

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'system',
      trigger_type: 'scheduled',
      trigger_payload: JSON.stringify({ name: 'fleet-daily-health' }),
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
    const checks = await runFleetHealthChecks(registry, ctx);
    const channel = resolveChannel([process.env.SLACK_ALERTS_CHANNEL], '#ops-manager-alerts');
    const postSkill = registry.get('slack.post-message');

    const parent = (await postSkill.execute(
      postMessageInputSchema.parse({
        channel,
        text: formatFleetDailyHealthOverview(checks),
      }),
      ctx,
    )) as PostMessageOutput;

    await postSkill.execute(
      postMessageInputSchema.parse({
        channel,
        text: formatGhlTokenCheckSummary(checks.ghl),
        threadTs: parent.ts,
      }),
      ctx,
    );

    await postSkill.execute(
      postMessageInputSchema.parse({
        channel,
        text: formatAssistableOAuthCheckSummary(checks.assistable),
        threadTs: parent.ts,
      }),
      ctx,
    );

    await postSkill.execute(
      postMessageInputSchema.parse({
        channel,
        text: formatN8nWorkflowCheckSummary(checks.n8n),
        threadTs: parent.ts,
      }),
      ctx,
    );

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify({
          ghl: checks.ghl.summary,
          assistable: checks.assistable.summary,
          n8n: checks.n8n.summary,
          slackThreadTs: parent.ts,
        }),
        completed_at: new Date(),
      },
    });

    log.info(
      {
        ghl: checks.ghl.summary,
        assistable: checks.assistable.summary,
        n8n: checks.n8n.summary,
      },
      'Fleet daily health job succeeded',
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

    log.error({ err }, 'Fleet daily health job failed');
    throw err;
  }
}

export async function runFleetHealthChecks(
  registry: SkillRegistry,
  ctx: SkillContext,
): Promise<FleetDailyHealthChecks> {
  const checkInput = { includeInactive: false };

  const ghlSkill = registry.get('ghl.check-pit-token') as Skill<
    CheckPitTokenInput,
    CheckPitTokenOutput
  >;
  const assistableSkill = registry.get('assistable.check-oauth-status') as Skill<
    CheckAssistableOAuthInput,
    CheckAssistableOAuthOutput
  >;
  const n8nSkill = registry.get('n8n.check-workflow-health') as Skill<
    CheckN8nWorkflowHealthInput,
    CheckN8nWorkflowHealthOutput
  >;

  const [ghl, assistable, n8n] = await Promise.all([
    ghlSkill.execute(checkPitTokenInputSchema.parse(checkInput), ctx),
    assistableSkill.execute(checkAssistableOAuthInputSchema.parse(checkInput), ctx),
    n8nSkill.execute(checkN8nWorkflowHealthInputSchema.parse(checkInput), ctx),
  ]);

  return { ghl, assistable, n8n };
}