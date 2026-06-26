import { randomUUID } from 'node:crypto';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import {
  clientCheckinAttentionSweepCommandArgsSchema,
  executeClientCheckinAttentionSweep,
  normalizeClientCheckinAttentionSweepConcurrency,
  normalizeClientCheckinAttentionSweepLimit,
  normalizeClientCheckinAttentionSweepMinHours,
  normalizeClientCheckinAttentionSweepMinSignals,
  normalizeClientCheckinAttentionSweepSinceHours,
  type ClientCheckinAttentionSweepCommandArgs,
  type ClientCheckinAttentionSweepSummary,
} from '../lib/client-checkin/attention-sweep.js';
import {
  generateClientCheckinBriefInputSchema,
  type GenerateClientCheckinBriefInput,
  type GenerateClientCheckinBriefOutput,
} from '../skills/client-checkin/generate-brief.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const CLIENT_CHECKIN_ATTENTION_SWEEP_QUEUE = 'client-checkin-attention-sweep';

export interface ClientCheckinAttentionSweepRunOptions {
  triggerType?: 'scheduled' | 'manual';
  triggerPayload?: Record<string, unknown>;
  input?: ClientCheckinAttentionSweepCommandArgs;
}

export function isClientCheckinAttentionSweepEnabled(): boolean {
  return process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_ENABLED?.toLowerCase() === 'true';
}

export function getClientCheckinAttentionSweepCron(): string {
  return process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_CRON ?? '35 16 * * *';
}

export function getClientCheckinAttentionSweepWindowHours(): number {
  return normalizeClientCheckinAttentionSweepSinceHours(
    Number(process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_HOURS ?? 24),
  );
}

export function getClientCheckinAttentionSweepMinSignals(): number {
  return normalizeClientCheckinAttentionSweepMinSignals(
    Number(process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MIN_SIGNALS ?? 2),
  );
}

export function getClientCheckinAttentionSweepMinHours(): number {
  return normalizeClientCheckinAttentionSweepMinHours(
    Number(process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MIN_HOURS ?? 24),
  );
}

export function getClientCheckinAttentionSweepLimit(): number {
  return normalizeClientCheckinAttentionSweepLimit(
    Number(process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_LIMIT ?? 5),
  );
}

export function getClientCheckinAttentionSweepConcurrency(): number {
  return normalizeClientCheckinAttentionSweepConcurrency(
    Number(process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_CONCURRENCY ?? 3),
  );
}

export function getClientCheckinAttentionSweepModel(): string | undefined {
  const configured = process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MODEL?.trim();
  return configured || undefined;
}

export async function runClientCheckinAttentionSweep(
  registry: SkillRegistry,
  options: ClientCheckinAttentionSweepRunOptions = {},
): Promise<ClientCheckinAttentionSweepSummary> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const parsedInput = clientCheckinAttentionSweepCommandArgsSchema.parse(options.input ?? {});
  const input = {
    sinceHours: parsedInput.sinceHours ?? getClientCheckinAttentionSweepWindowHours(),
    minSignals: parsedInput.minSignals ?? getClientCheckinAttentionSweepMinSignals(),
    minHours: parsedInput.minHours ?? getClientCheckinAttentionSweepMinHours(),
    limit: parsedInput.limit ?? getClientCheckinAttentionSweepLimit(),
    concurrency: parsedInput.concurrency ?? getClientCheckinAttentionSweepConcurrency(),
    model: getClientCheckinAttentionSweepModel(),
  };
  const triggerType = options.triggerType ?? 'scheduled';
  const triggerPayload = options.triggerPayload ?? { name: 'client-checkin-attention-sweep' };

  log.info(
    {
      sinceHours: input.sinceHours,
      minSignals: input.minSignals,
      minHours: input.minHours,
      limit: input.limit,
      concurrency: input.concurrency,
    },
    'Client check-in attention sweep job starting',
  );

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'client-checkin',
      trigger_type: triggerType,
      trigger_payload: JSON.stringify(triggerPayload),
      status: 'running',
      input: JSON.stringify(input),
      started_at: new Date(),
    },
  });

  const ctx: SkillContext = {
    jobId,
    agentId: 'client-checkin',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const generateBriefSkill = registry.get('client-checkin.generate-brief') as Skill<
      GenerateClientCheckinBriefInput,
      GenerateClientCheckinBriefOutput
    >;
    const summary = await executeClientCheckinAttentionSweep({
      jobId,
      ctx,
      ...input,
      generateBrief: async (briefInput, skillCtx) =>
        generateBriefSkill.execute(
          generateClientCheckinBriefInputSchema.parse(briefInput),
          skillCtx,
        ),
    });

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify({
          sinceHours: summary.sinceHours,
          minSignals: summary.minSignals,
          minHours: summary.minHours,
          limit: summary.limit,
          concurrency: summary.concurrency,
          fleetTotalAttentionSignals: summary.fleetTotalAttentionSignals,
          fleetAccountsWithAttention: summary.fleetAccountsWithAttention,
          totalCandidates: summary.totalCandidates,
          generated: summary.generated,
          skippedRecent: summary.skippedRecent,
          failed: summary.failed,
          attentionBriefs: summary.attentionBriefs,
          healthyBriefs: summary.healthyBriefs,
          watchBriefs: summary.watchBriefs,
          atRiskBriefs: summary.atRiskBriefs,
          results: summary.results,
        }),
        completed_at: new Date(),
      },
    });

    log.info(
      {
        totalCandidates: summary.totalCandidates,
        generated: summary.generated,
        skippedRecent: summary.skippedRecent,
        failed: summary.failed,
        attentionBriefs: summary.attentionBriefs,
      },
      'Client check-in attention sweep job succeeded',
    );

    return summary;
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

    log.error({ err }, 'Client check-in attention sweep job failed');
    throw err;
  }
}
