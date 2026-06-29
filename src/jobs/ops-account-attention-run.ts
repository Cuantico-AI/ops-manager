import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import {
  normalizeOpsAccountAttentionRunConcurrency,
  normalizeOpsAccountAttentionRunLimit,
  normalizeOpsAccountAttentionRunMinSignals,
  opsAccountAttentionRunCommandArgsSchema,
  type OpsAccountAttentionRunCommandArgs,
  type OpsAccountAttentionRunSummary,
} from '../lib/ops/account-attention-run.js';
import {
  formatOpsAccountAttentionRunOutput,
  opsAccountAttentionRunInputSchema,
  type OpsAccountAttentionRunInput,
} from '../skills/ops/account-attention-run.js';
import {
  postMessageInputSchema,
  type PostMessageInput,
  type PostMessageOutput,
} from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const OPS_ACCOUNT_ATTENTION_RUN_QUEUE = 'ops-account-attention-run';

export interface OpsAccountAttentionRunOptions {
  triggerType?: 'scheduled' | 'manual';
  triggerPayload?: Record<string, unknown>;
  input?: OpsAccountAttentionRunCommandArgs;
}

export function isOpsAccountAttentionRunEnabled(): boolean {
  return process.env.OPS_ACCOUNT_ATTENTION_RUN_ENABLED?.toLowerCase() === 'true';
}

export function getOpsAccountAttentionRunCron(): string {
  return process.env.OPS_ACCOUNT_ATTENTION_RUN_CRON ?? '45 16 * * *';
}

export function getOpsAccountAttentionRunWindowHours(): number {
  const configured = Number(process.env.OPS_ACCOUNT_ATTENTION_RUN_HOURS ?? 24);
  if (!Number.isFinite(configured)) {
    return 24;
  }
  return Math.min(Math.max(Math.trunc(configured), 1), 168);
}

export function getOpsAccountAttentionRunLimit(): number {
  return normalizeOpsAccountAttentionRunLimit(
    Number(process.env.OPS_ACCOUNT_ATTENTION_RUN_LIMIT ?? 5),
  );
}

export function getOpsAccountAttentionRunMinSignals(): number {
  return normalizeOpsAccountAttentionRunMinSignals(
    Number(process.env.OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS ?? 2),
  );
}

export function getOpsAccountAttentionRunAccountDigestLimit(): number {
  const configured = Number(process.env.OPS_ACCOUNT_ATTENTION_RUN_DIGEST_LIMIT ?? 5);
  if (!Number.isFinite(configured)) {
    return 5;
  }
  return Math.min(Math.max(Math.trunc(configured), 1), 25);
}

export function getOpsAccountAttentionRunConcurrency(): number {
  return normalizeOpsAccountAttentionRunConcurrency(
    Number(process.env.OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY ?? 3),
  );
}

export async function runOpsAccountAttentionRun(
  registry: SkillRegistry,
  options: OpsAccountAttentionRunOptions = {},
): Promise<OpsAccountAttentionRunSummary> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const parsedInput = opsAccountAttentionRunCommandArgsSchema.parse(options.input ?? {});
  const input: OpsAccountAttentionRunInput = opsAccountAttentionRunInputSchema.parse({
    sinceHours: parsedInput.sinceHours ?? getOpsAccountAttentionRunWindowHours(),
    limit: parsedInput.limit ?? getOpsAccountAttentionRunLimit(),
    minSignals: parsedInput.minSignals ?? getOpsAccountAttentionRunMinSignals(),
    accountDigestLimit:
      parsedInput.accountDigestLimit ?? getOpsAccountAttentionRunAccountDigestLimit(),
    concurrency: parsedInput.concurrency ?? getOpsAccountAttentionRunConcurrency(),
  });
  const triggerType = options.triggerType ?? 'scheduled';
  const triggerPayload = options.triggerPayload ?? { name: 'ops-account-attention-run' };

  log.info(
    {
      sinceHours: input.sinceHours,
      limit: input.limit,
      minSignals: input.minSignals,
      accountDigestLimit: input.accountDigestLimit,
      concurrency: input.concurrency,
    },
    'Ops account attention run job starting',
  );

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'ops-digest',
      trigger_type: triggerType,
      trigger_payload: JSON.stringify(triggerPayload),
      status: 'running',
      input: JSON.stringify(input),
      started_at: new Date(),
    },
  });

  const ctx: SkillContext = {
    jobId,
    agentId: 'ops-digest',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const runSkill = registry.get('ops.account-attention-run') as Skill<
      OpsAccountAttentionRunInput,
      OpsAccountAttentionRunSummary
    >;
    const output = await runSkill.execute(input, ctx);
    let slackTs: string | undefined;

    if (output.totalCandidates > 0) {
      const channel = resolveChannel(
        [process.env.OPS_ACCOUNT_ATTENTION_RUN_CHANNEL, process.env.SLACK_ALERTS_CHANNEL],
        '#ops-manager-alerts',
      );
      const postSkill = registry.get('slack.post-message') as Skill<
        PostMessageInput,
        PostMessageOutput
      >;
      const post = await postSkill.execute(
        postMessageInputSchema.parse({
          channel,
          text: formatOpsAccountAttentionRunOutput(output),
        }),
        ctx,
      );
      slackTs = post.ts;
    }

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify({
          sinceHours: output.sinceHours,
          limit: output.limit,
          minSignals: output.minSignals,
          accountDigestLimit: output.accountDigestLimit,
          concurrency: output.concurrency,
          totalCandidates: output.totalCandidates,
          digested: output.digested,
          failed: output.failed,
          totalAttentionSignals: output.totalAttentionSignals,
          postedToSlack: slackTs !== undefined,
          slackTs,
        }),
        completed_at: new Date(),
      },
    });

    log.info(
      {
        totalCandidates: output.totalCandidates,
        digested: output.digested,
        failed: output.failed,
        postedToSlack: slackTs !== undefined,
      },
      'Ops account attention run job succeeded',
    );

    return output;
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

    log.error({ err }, 'Ops account attention run job failed');
    throw err;
  }
}
