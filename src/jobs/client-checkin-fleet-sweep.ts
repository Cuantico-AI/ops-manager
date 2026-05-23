import { randomUUID } from 'node:crypto';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import {
  clientCheckinFleetSweepCommandArgsSchema,
  executeClientCheckinFleetSweep,
  normalizeClientCheckinFleetSweepConcurrency,
  normalizeClientCheckinFleetSweepLimit,
  normalizeClientCheckinFleetSweepMinHours,
  type ClientCheckinFleetSweepCommandArgs,
  type ClientCheckinFleetSweepSummary,
} from '../lib/client-checkin/fleet-sweep.js';
import {
  generateClientCheckinBriefInputSchema,
  type GenerateClientCheckinBriefInput,
  type GenerateClientCheckinBriefOutput,
} from '../skills/client-checkin/generate-brief.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const CLIENT_CHECKIN_FLEET_SWEEP_QUEUE = 'client-checkin-fleet-sweep';

export interface ClientCheckinFleetSweepRunOptions {
  triggerType?: 'scheduled' | 'manual';
  triggerPayload?: Record<string, unknown>;
  input?: ClientCheckinFleetSweepCommandArgs;
}

export function isClientCheckinFleetSweepEnabled(): boolean {
  return process.env.CLIENT_CHECKIN_FLEET_SWEEP_ENABLED?.toLowerCase() === 'true';
}

export function getClientCheckinFleetSweepCron(): string {
  return process.env.CLIENT_CHECKIN_FLEET_SWEEP_CRON ?? '0 15 * * *';
}

export function getClientCheckinFleetSweepMinHours(): number {
  return normalizeClientCheckinFleetSweepMinHours(
    Number(process.env.CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS ?? 24),
  );
}

export function getClientCheckinFleetSweepConcurrency(): number {
  return normalizeClientCheckinFleetSweepConcurrency(
    Number(process.env.CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY ?? 3),
  );
}

export function getClientCheckinFleetSweepLimit(): number | undefined {
  const configured = process.env.CLIENT_CHECKIN_FLEET_SWEEP_LIMIT;
  return configured ? normalizeClientCheckinFleetSweepLimit(Number(configured)) : undefined;
}

export function getClientCheckinFleetSweepIncludeInactive(): boolean {
  return process.env.CLIENT_CHECKIN_FLEET_SWEEP_INCLUDE_INACTIVE?.toLowerCase() === 'true';
}

export function getClientCheckinFleetSweepModel(): string | undefined {
  const configured = process.env.CLIENT_CHECKIN_FLEET_SWEEP_MODEL?.trim();
  return configured || undefined;
}

export async function runClientCheckinFleetSweep(
  registry: SkillRegistry,
  options: ClientCheckinFleetSweepRunOptions = {},
): Promise<ClientCheckinFleetSweepSummary> {
  const jobId = randomUUID();
  const log = childLogger({ jobId });
  const parsedInput = clientCheckinFleetSweepCommandArgsSchema.parse(options.input ?? {});
  const input = {
    minHours: parsedInput.minHours ?? getClientCheckinFleetSweepMinHours(),
    includeInactive: parsedInput.includeInactive ?? getClientCheckinFleetSweepIncludeInactive(),
    limit: parsedInput.limit ?? getClientCheckinFleetSweepLimit(),
    concurrency: parsedInput.concurrency ?? getClientCheckinFleetSweepConcurrency(),
    model: getClientCheckinFleetSweepModel(),
  };
  const triggerType = options.triggerType ?? 'scheduled';
  const triggerPayload = options.triggerPayload ?? { name: 'client-checkin-fleet-sweep' };

  log.info(
    {
      minHours: input.minHours,
      includeInactive: input.includeInactive,
      limit: input.limit,
      concurrency: input.concurrency,
    },
    'Client check-in fleet sweep job starting',
  );

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'client-checkin',
      triggerType,
      JSON.stringify(triggerPayload),
      'running',
      JSON.stringify(input),
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
    const generateBriefSkill = registry.get('client-checkin.generate-brief') as Skill<
      GenerateClientCheckinBriefInput,
      GenerateClientCheckinBriefOutput
    >;
    const summary = await executeClientCheckinFleetSweep({
      jobId,
      ctx,
      ...input,
      generateBrief: async (briefInput, skillCtx) =>
        generateBriefSkill.execute(
          generateClientCheckinBriefInputSchema.parse(briefInput),
          skillCtx,
        ),
    });

    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        minHours: summary.minHours,
        includeInactive: summary.includeInactive,
        limit: summary.limit,
        concurrency: summary.concurrency,
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
      jobId,
    ]);

    log.info(
      {
        totalCandidates: summary.totalCandidates,
        generated: summary.generated,
        skippedRecent: summary.skippedRecent,
        failed: summary.failed,
        attentionBriefs: summary.attentionBriefs,
      },
      'Client check-in fleet sweep job succeeded',
    );

    return summary;
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

    log.error({ err }, 'Client check-in fleet sweep job failed');
    throw err;
  }
}
