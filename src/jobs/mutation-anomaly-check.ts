import { resolveChannel } from '../lib/slack/channel.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { randomUUID } from 'node:crypto';
import {
    postMessageInputSchema,
    type PostMessageInput,
    type PostMessageOutput,
} from '../skills/slack/post-message.js';
import type { SkillRegistry } from '../skills/_registry.js';
import type { Skill, SkillContext } from '../skills/_types.js';

export const MUTATION_ANOMALY_CHECK_QUEUE = 'mutation-anomaly-check';

export function getMutationAnomalyCheckCron(): string {
    return process.env.MUTATION_ANOMALY_CHECK_CRON ?? '*/15 * * * *';
}

export function getMutationAnomalyCheckWindowMinutes(): number {
    const configured = Number(process.env.MUTATION_ANOMALY_CHECK_MINUTES ?? 30);
    if (!Number.isFinite(configured)) {
        return 30;
    }
    return Math.min(Math.max(Math.trunc(configured), 5), 1440);
}

interface AnomalyRow {
    id: string;
    job_id: string;
    action: string;
    target: string;
    timestamp: Date | string;
}

/**
 * Mutation anomaly check (Phase 6 gate 2).
 *
 * Per the truthful-audit invariant (wrap-mutation.ts), a mutation must never
 * leave a `mutated: true` row with a NULL output — wrapMutation always writes
 * the real result or re-throws on failure. A row matching that pattern means
 * a write happened to a live system with no recorded outcome — a process
 * crash mid-write, or a bypass of wrapMutation's discipline. This runs as a
 * periodic sweep rather than per-job, since job files generate their own
 * internal jobId independent of the BullMQ job id.
 */
export async function runMutationAnomalyCheck(registry: SkillRegistry): Promise<void> {
    const log = childLogger({ job: 'mutation-anomaly-check' });
    const windowMinutes = getMutationAnomalyCheckWindowMinutes();

    log.info({ windowMinutes }, 'Mutation anomaly check starting');

    let rows: AnomalyRow[];
    try {
        const result = await query<AnomalyRow>(
            `SELECT id, job_id, action, target, timestamp
       FROM audit_log
       WHERE mutated = TRUE
         AND output IS NULL
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 minute')
       ORDER BY timestamp DESC`,
            [windowMinutes],
        );
        rows = result.rows;
    } catch (err) {
        log.error({ err }, 'Mutation anomaly check failed to query audit_log');
        return;
    }

    if (rows.length === 0) {
        log.info({ anomalies: 0 }, 'Mutation anomaly check complete — no anomalies found');
        return;
    }

    log.error({ anomalies: rows.length, rows }, 'Mutation anomalies detected');

    try {
        const channel = resolveChannel(
            [process.env.MUTATION_ANOMALY_ALERT_CHANNEL, process.env.SLACK_ALERTS_CHANNEL],
            '#ops-manager-alerts',
        );
        const postSkill = registry.get('slack.post-message') as Skill<PostMessageInput, PostMessageOutput>;

        const ctx: SkillContext = {
            jobId: randomUUID(),
            agentId: 'mutation-anomaly-check',
            audit: auditLogger,
            approval: approvalGate,
            llm: llmClient,
        };

        const lines = [
            ':rotating_light: *Mutation anomaly detected*',
            `Found ${rows.length} audit_log row(s) with mutated=true and output=NULL in the last ${windowMinutes} minutes.`,
            ...rows
                .slice(0, 10)
                .map((r) => `• audit_log #${r.id} — \`${r.action}\` on \`${r.target}\` (job ${r.job_id})`),
            rows.length > 10 ? `…and ${rows.length - 10} more` : '',
            'This means a mutation may have executed with no recorded outcome. Investigate immediately.',
        ].filter(Boolean);

        await postSkill.execute(
            postMessageInputSchema.parse({
                channel,
                text: lines.join('\n'),
            }),
            ctx,
        );
    } catch (err) {
        log.error({ err }, 'Failed to post mutation anomaly alert to Slack');
    }
}