import { z } from 'zod';
import { query } from '../db/client.js';
import { ValidationError } from '../errors.js';
import { persistClientCheckinBrief, type ClientCheckinBriefRecord } from './briefs.js';
import type {
  GenerateClientCheckinBriefInput,
  GenerateClientCheckinBriefOutput,
} from '../../skills/client-checkin/generate-brief.js';
import type { SkillContext } from '../../skills/_types.js';

const DEFAULT_CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS = 24;
const MAX_CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS = 720;
const DEFAULT_CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY = 3;
const MAX_CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY = 10;
const MAX_CLIENT_CHECKIN_FLEET_SWEEP_LIMIT = 500;
const MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS = 10;

export interface ClientCheckinFleetSweepCandidate {
  accountId: string;
  accountName: string;
  accountStatus: string;
  latestBriefGeneratedAt: string | null;
}

interface ClientCheckinFleetSweepCandidateRow {
  id: string;
  name: string;
  status: string;
  latest_brief_generated_at: Date | string | null;
}

export interface ListClientCheckinFleetSweepCandidatesInput {
  includeInactive?: boolean;
  limit?: number;
}

export type ClientCheckinFleetSweepResult =
  | {
      accountId: string;
      accountName: string;
      action: 'generated';
      briefId: string;
      status: 'healthy' | 'watch' | 'at_risk';
      generatedAt: string;
      openIssueCount: number;
      followUpQuestionCount: number;
    }
  | {
      accountId: string;
      accountName: string;
      action: 'skipped_recent';
      latestBriefGeneratedAt: string;
    }
  | {
      accountId: string;
      accountName: string;
      action: 'failed';
      error: string;
    };

export interface ClientCheckinFleetSweepSummary {
  minHours: number;
  includeInactive: boolean;
  limit?: number;
  concurrency: number;
  startedAt: string;
  completedAt: string;
  totalCandidates: number;
  generated: number;
  skippedRecent: number;
  failed: number;
  healthyBriefs: number;
  watchBriefs: number;
  atRiskBriefs: number;
  attentionBriefs: number;
  results: ClientCheckinFleetSweepResult[];
}

export interface ExecuteClientCheckinFleetSweepInput {
  jobId: string;
  ctx: SkillContext;
  minHours?: number;
  includeInactive?: boolean;
  limit?: number;
  concurrency?: number;
  model?: string;
  now?: Date;
  generateBrief: (
    input: GenerateClientCheckinBriefInput,
    ctx: SkillContext,
  ) => Promise<GenerateClientCheckinBriefOutput>;
  persistBrief?: (input: {
    jobId: string;
    output: GenerateClientCheckinBriefOutput;
  }) => Promise<ClientCheckinBriefRecord>;
}

export async function listClientCheckinFleetSweepCandidates(
  input: ListClientCheckinFleetSweepCandidatesInput = {},
): Promise<ClientCheckinFleetSweepCandidate[]> {
  const includeInactive = input.includeInactive === true;
  const limit = normalizeClientCheckinFleetSweepLimit(input.limit);

  const { rows } = await query<ClientCheckinFleetSweepCandidateRow>(
    `SELECT
       a.id,
       a.name,
       a.status,
       latest.generated_at AS latest_brief_generated_at
     FROM accounts a
     LEFT JOIN LATERAL (
       SELECT generated_at
       FROM client_checkin_briefs ccb
       WHERE ccb.account_id = a.id
       ORDER BY generated_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE ($1::BOOLEAN OR a.status = 'active')
     ORDER BY a.name ASC
     LIMIT $2`,
    [includeInactive, limit ?? null],
  );

  return rows.map(mapClientCheckinFleetSweepCandidateRow);
}

export async function executeClientCheckinFleetSweep(
  input: ExecuteClientCheckinFleetSweepInput,
): Promise<ClientCheckinFleetSweepSummary> {
  const minHours = normalizeClientCheckinFleetSweepMinHours(input.minHours);
  const includeInactive = input.includeInactive === true;
  const limit = normalizeClientCheckinFleetSweepLimit(input.limit);
  const concurrency = normalizeClientCheckinFleetSweepConcurrency(input.concurrency);
  const startedAt = (input.now ?? new Date()).toISOString();
  const cutoffMs = new Date(startedAt).getTime() - minHours * 60 * 60 * 1000;
  const persistBrief = input.persistBrief ?? persistClientCheckinBrief;
  const candidates = await listClientCheckinFleetSweepCandidates({ includeInactive, limit });
  const indexedResults: Array<{ index: number; result: ClientCheckinFleetSweepResult }> = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < candidates.length) {
      const currentIndex = index;
      index += 1;
      const candidate = candidates[currentIndex];
      if (!candidate) {
        continue;
      }

      const recentGeneratedAt = candidate.latestBriefGeneratedAt;
      if (recentGeneratedAt && new Date(recentGeneratedAt).getTime() >= cutoffMs) {
        indexedResults.push({
          index: currentIndex,
          result: {
            accountId: candidate.accountId,
            accountName: candidate.accountName,
            action: 'skipped_recent',
            latestBriefGeneratedAt: recentGeneratedAt,
          },
        });
        continue;
      }

      try {
        const output = await input.generateBrief(
          {
            accountId: candidate.accountId,
            includeInactive: true,
            model: input.model,
          },
          input.ctx,
        );
        const brief = await persistBrief({ jobId: input.jobId, output });
        indexedResults.push({
          index: currentIndex,
          result: {
            accountId: output.accountId,
            accountName: output.accountName,
            action: 'generated',
            briefId: brief.id,
            status: output.status,
            generatedAt: output.generatedAt,
            openIssueCount: output.openIssues.length,
            followUpQuestionCount: output.followUpQuestions.length,
          },
        });
      } catch (err) {
        indexedResults.push({
          index: currentIndex,
          result: {
            accountId: candidate.accountId,
            accountName: candidate.accountName,
            action: 'failed',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(candidates.length, 1)) }, () => worker()),
  );

  const results = indexedResults
    .sort((left, right) => left.index - right.index)
    .map((item) => item.result);
  return summarizeClientCheckinFleetSweep({
    minHours,
    includeInactive,
    limit,
    concurrency,
    startedAt,
    completedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    results,
  });
}

export const clientCheckinFleetSweepCommandArgsSchema = z.object({
  minHours: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
  includeInactive: z.boolean().optional(),
});

export type ClientCheckinFleetSweepCommandArgs = z.infer<
  typeof clientCheckinFleetSweepCommandArgsSchema
>;

export function parseClientCheckinFleetSweepCommandArgs(
  args: string,
): ClientCheckinFleetSweepCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const parsed: ClientCheckinFleetSweepCommandArgs = {};

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }

    if (/^\d+$/.test(token)) {
      if (parsed.minHours !== undefined) {
        throw clientCheckinFleetSweepUsageError();
      }
      parsed.minHours = Number(token);
      continue;
    }

    if (token === '--include-inactive') {
      parsed.includeInactive = true;
      continue;
    }

    const [flag, inlineValue] = token.split('=', 2);
    if (flag === '--min-hours' || flag === '--hours') {
      const value = inlineValue ?? tokens[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw clientCheckinFleetSweepUsageError();
      }
      parsed.minHours = Number(value);
      if (!inlineValue) i += 1;
      continue;
    }

    if (flag === '--limit') {
      const value = inlineValue ?? tokens[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw clientCheckinFleetSweepUsageError();
      }
      parsed.limit = Number(value);
      if (!inlineValue) i += 1;
      continue;
    }

    if (flag === '--concurrency') {
      const value = inlineValue ?? tokens[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw clientCheckinFleetSweepUsageError();
      }
      parsed.concurrency = Number(value);
      if (!inlineValue) i += 1;
      continue;
    }

    throw clientCheckinFleetSweepUsageError();
  }

  return parsed;
}

export function formatClientCheckinFleetSweepOutput(
  summary: ClientCheckinFleetSweepSummary,
): string {
  const lines = [
    'Client check-in fleet sweep complete.',
    `Skip threshold: ${summary.minHours}h`,
    `Candidates: ${summary.totalCandidates}`,
    `Generated: ${summary.generated}`,
    `Skipped recent: ${summary.skippedRecent}`,
    `Failed: ${summary.failed}`,
    `Generated statuses: healthy ${summary.healthyBriefs}, watch ${summary.watchBriefs}, at-risk ${summary.atRiskBriefs}`,
  ];

  const generated = summary.results.filter((result) => result.action === 'generated');
  if (generated.length > 0) {
    lines.push('', 'Generated briefs:');
    for (const result of generated.slice(0, MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS)) {
      lines.push(
        `• ${result.accountName} — ${result.status.replace('_', ' ')}; brief ${result.briefId}; issues ${result.openIssueCount}; follow-ups ${result.followUpQuestionCount}`,
      );
    }
    if (generated.length > MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS) {
      lines.push(`• …and ${generated.length - MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS} more`);
    }
  } else if (summary.totalCandidates > 0 && summary.skippedRecent === summary.totalCandidates) {
    lines.push('', 'No new briefs generated; every candidate already has a recent brief.');
  }

  const failures = summary.results.filter((result) => result.action === 'failed');
  if (failures.length > 0) {
    lines.push('', 'Failures:');
    for (const result of failures.slice(0, MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS)) {
      lines.push(`• ${result.accountName} — ${result.error}`);
    }
    if (failures.length > MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS) {
      lines.push(`• …and ${failures.length - MAX_CLIENT_CHECKIN_FLEET_SWEEP_FORMAT_ROWS} more`);
    }
  }

  return lines.join('\n');
}

export function normalizeClientCheckinFleetSweepMinHours(hours: number | undefined): number {
  if (!hours || !Number.isFinite(hours)) {
    return DEFAULT_CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS;
  }

  return Math.min(Math.max(Math.trunc(hours), 1), MAX_CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS);
}

export function normalizeClientCheckinFleetSweepConcurrency(
  concurrency: number | undefined,
): number {
  if (!concurrency || !Number.isFinite(concurrency)) {
    return DEFAULT_CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY;
  }

  return Math.min(Math.max(Math.trunc(concurrency), 1), MAX_CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY);
}

export function normalizeClientCheckinFleetSweepLimit(
  limit: number | undefined,
): number | undefined {
  if (!limit || !Number.isFinite(limit)) {
    return undefined;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_CLIENT_CHECKIN_FLEET_SWEEP_LIMIT);
}

function summarizeClientCheckinFleetSweep(input: {
  minHours: number;
  includeInactive: boolean;
  limit?: number;
  concurrency: number;
  startedAt: string;
  completedAt: string;
  totalCandidates: number;
  results: ClientCheckinFleetSweepResult[];
}): ClientCheckinFleetSweepSummary {
  const generatedResults = input.results.filter((result) => result.action === 'generated');
  const healthyBriefs = generatedResults.filter((result) => result.status === 'healthy').length;
  const watchBriefs = generatedResults.filter((result) => result.status === 'watch').length;
  const atRiskBriefs = generatedResults.filter((result) => result.status === 'at_risk').length;

  return {
    ...input,
    generated: generatedResults.length,
    skippedRecent: input.results.filter((result) => result.action === 'skipped_recent').length,
    failed: input.results.filter((result) => result.action === 'failed').length,
    healthyBriefs,
    watchBriefs,
    atRiskBriefs,
    attentionBriefs: watchBriefs + atRiskBriefs,
  };
}

function mapClientCheckinFleetSweepCandidateRow(
  row: ClientCheckinFleetSweepCandidateRow,
): ClientCheckinFleetSweepCandidate {
  return {
    accountId: row.id,
    accountName: row.name,
    accountStatus: row.status,
    latestBriefGeneratedAt:
      row.latest_brief_generated_at instanceof Date
        ? row.latest_brief_generated_at.toISOString()
        : row.latest_brief_generated_at,
  };
}

function clientCheckinFleetSweepUsageError(): ValidationError {
  return new ValidationError(
    'Usage: /ops checkin-fleet-run [hours] [--limit=N] [--concurrency=N] [--include-inactive]',
  );
}
