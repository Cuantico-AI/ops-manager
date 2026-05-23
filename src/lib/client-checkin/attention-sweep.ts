import { z } from 'zod';
import { query } from '../db/client.js';
import { ValidationError } from '../errors.js';
import { persistClientCheckinBrief, type ClientCheckinBriefRecord } from './briefs.js';
import {
  normalizeClientCheckinFleetSweepConcurrency,
  normalizeClientCheckinFleetSweepMinHours,
} from './fleet-sweep.js';
import {
  fetchOpsFleetDigest,
  normalizeOpsFleetDigestHours,
  type FetchOpsFleetDigestInput,
  type OpsFleetDigestAccountSignal,
} from '../ops/fleet-digest.js';
import {
  normalizeOpsAccountAttentionRunLimit,
  normalizeOpsAccountAttentionRunMinSignals,
  selectOpsAccountAttentionCandidates,
} from '../ops/account-attention-run.js';
import type {
  GenerateClientCheckinBriefInput,
  GenerateClientCheckinBriefOutput,
} from '../../skills/client-checkin/generate-brief.js';
import type { SkillContext } from '../../skills/_types.js';

const MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS = 10;

interface LatestClientCheckinBriefRow {
  account_id: string;
  generated_at: Date | string;
}

export type ClientCheckinAttentionSweepCandidate = OpsFleetDigestAccountSignal;

export type ClientCheckinAttentionSweepResult =
  | {
      accountId: string;
      accountName: string;
      action: 'generated';
      signalCategories: number;
      attentionSignals: number;
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
      signalCategories: number;
      attentionSignals: number;
      latestBriefGeneratedAt: string;
    }
  | {
      accountId: string;
      accountName: string;
      action: 'failed';
      signalCategories: number;
      attentionSignals: number;
      error: string;
    };

export interface ClientCheckinAttentionSweepSummary {
  sinceHours: number;
  since: string;
  minSignals: number;
  minHours: number;
  limit: number;
  concurrency: number;
  startedAt: string;
  completedAt: string;
  fleetTotalAttentionSignals: number;
  fleetAccountsWithAttention: number;
  totalCandidates: number;
  generated: number;
  skippedRecent: number;
  failed: number;
  healthyBriefs: number;
  watchBriefs: number;
  atRiskBriefs: number;
  attentionBriefs: number;
  results: ClientCheckinAttentionSweepResult[];
}

export interface ExecuteClientCheckinAttentionSweepInput {
  jobId: string;
  ctx: SkillContext;
  sinceHours?: number;
  minSignals?: number;
  minHours?: number;
  limit?: number;
  concurrency?: number;
  model?: string;
  now?: Date;
  fetchFleetDigest?: (input: FetchOpsFleetDigestInput) => Promise<{
    since: string;
    totalAttentionSignals: number;
    accountsWithAttention: number;
    multiSignalAccounts: OpsFleetDigestAccountSignal[];
    topAccounts: OpsFleetDigestAccountSignal[];
  }>;
  fetchLatestBriefs?: (accountIds: string[]) => Promise<Map<string, string>>;
  generateBrief: (
    input: GenerateClientCheckinBriefInput,
    ctx: SkillContext,
  ) => Promise<GenerateClientCheckinBriefOutput>;
  persistBrief?: (input: {
    jobId: string;
    output: GenerateClientCheckinBriefOutput;
  }) => Promise<ClientCheckinBriefRecord>;
}

export const clientCheckinAttentionSweepCommandArgsSchema = z.object({
  sinceHours: z.number().int().positive().optional(),
  minSignals: z.number().int().positive().optional(),
  minHours: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});

export type ClientCheckinAttentionSweepCommandArgs = z.infer<
  typeof clientCheckinAttentionSweepCommandArgsSchema
>;

export async function fetchLatestClientCheckinBriefsForAccounts(
  accountIds: string[],
): Promise<Map<string, string>> {
  if (accountIds.length === 0) {
    return new Map();
  }

  const { rows } = await query<LatestClientCheckinBriefRow>(
    `SELECT DISTINCT ON (account_id)
       account_id,
       generated_at
     FROM client_checkin_briefs
     WHERE account_id = ANY($1::UUID[])
     ORDER BY account_id, generated_at DESC`,
    [accountIds],
  );

  return new Map(
    rows.map((row) => [
      row.account_id,
      row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,
    ]),
  );
}

export async function executeClientCheckinAttentionSweep(
  input: ExecuteClientCheckinAttentionSweepInput,
): Promise<ClientCheckinAttentionSweepSummary> {
  const sinceHours = normalizeClientCheckinAttentionSweepSinceHours(input.sinceHours);
  const minSignals = normalizeClientCheckinAttentionSweepMinSignals(input.minSignals);
  const minHours = normalizeClientCheckinAttentionSweepMinHours(input.minHours);
  const limit = normalizeClientCheckinAttentionSweepLimit(input.limit);
  const concurrency = normalizeClientCheckinAttentionSweepConcurrency(input.concurrency);
  const startedAt = (input.now ?? new Date()).toISOString();
  const cutoffMs = new Date(startedAt).getTime() - minHours * 60 * 60 * 1000;
  const fleetDigest = await (input.fetchFleetDigest ?? fetchOpsFleetDigest)({
    sinceHours,
    limit,
  });
  const candidates = selectOpsAccountAttentionCandidates({
    multiSignalAccounts: fleetDigest.multiSignalAccounts,
    topAccounts: fleetDigest.topAccounts,
    minSignals,
    limit,
  });
  const latestBriefs = await (input.fetchLatestBriefs ?? fetchLatestClientCheckinBriefsForAccounts)(
    candidates.map((candidate) => candidate.accountId),
  );
  const persistBrief = input.persistBrief ?? persistClientCheckinBrief;
  const indexedResults: Array<{ index: number; result: ClientCheckinAttentionSweepResult }> = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < candidates.length) {
      const currentIndex = index;
      index += 1;
      const candidate = candidates[currentIndex];
      if (!candidate) {
        continue;
      }

      const latestBriefGeneratedAt = latestBriefs.get(candidate.accountId);
      if (latestBriefGeneratedAt && Date.parse(latestBriefGeneratedAt) >= cutoffMs) {
        indexedResults.push({
          index: currentIndex,
          result: {
            accountId: candidate.accountId,
            accountName: candidate.accountName,
            action: 'skipped_recent',
            signalCategories: candidate.signalCategories,
            attentionSignals: candidate.attentionSignals,
            latestBriefGeneratedAt,
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
            signalCategories: candidate.signalCategories,
            attentionSignals: candidate.attentionSignals,
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
            signalCategories: candidate.signalCategories,
            attentionSignals: candidate.attentionSignals,
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

  return summarizeClientCheckinAttentionSweep({
    sinceHours,
    since: fleetDigest.since,
    minSignals,
    minHours,
    limit,
    concurrency,
    startedAt,
    completedAt: new Date().toISOString(),
    fleetTotalAttentionSignals: fleetDigest.totalAttentionSignals,
    fleetAccountsWithAttention: fleetDigest.accountsWithAttention,
    totalCandidates: candidates.length,
    results,
  });
}

export function parseClientCheckinAttentionSweepCommandArgs(
  args: string,
): ClientCheckinAttentionSweepCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const parsed: ClientCheckinAttentionSweepCommandArgs = {};

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }

    if (/^\d+$/.test(token)) {
      if (parsed.sinceHours !== undefined) {
        throw clientCheckinAttentionSweepUsageError();
      }
      parsed.sinceHours = Number(token);
      continue;
    }

    const [flag, inlineValue] = token.split('=', 2);
    if (flag === '--hours') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.sinceHours = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }
    if (flag === '--limit') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.limit = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }
    if (flag === '--min-signals') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.minSignals = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }
    if (flag === '--min-hours') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.minHours = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }
    if (flag === '--concurrency') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.concurrency = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }

    throw clientCheckinAttentionSweepUsageError();
  }

  return parsed;
}

export function formatClientCheckinAttentionSweepOutput(
  summary: ClientCheckinAttentionSweepSummary,
): string {
  const lines = [
    'Client check-in attention sweep complete.',
    `Window: last ${summary.sinceHours} hour(s) since ${summary.since}`,
    `Filter: at least ${summary.minSignals} attention area(s); candidates up to ${summary.limit}`,
    `Skip threshold: ${summary.minHours}h since latest check-in brief`,
    `Fleet attention: ${summary.fleetTotalAttentionSignals} signal(s) across ${summary.fleetAccountsWithAttention} account(s)`,
    `Candidates: ${summary.totalCandidates}`,
    `Generated: ${summary.generated}`,
    `Skipped recent: ${summary.skippedRecent}`,
    `Failed: ${summary.failed}`,
    `Generated statuses: healthy ${summary.healthyBriefs}, watch ${summary.watchBriefs}, at-risk ${summary.atRiskBriefs}`,
  ];

  if (summary.totalCandidates === 0) {
    lines.push('', 'No accounts met the attention filter in this window.');
    return lines.join('\n');
  }

  const generated = summary.results.filter((result) => result.action === 'generated');
  if (generated.length > 0) {
    lines.push('', 'Generated briefs:');
    for (const result of generated.slice(0, MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS)) {
      lines.push(
        `- ${result.accountName} - ${result.status.replace('_', ' ')}; brief ${result.briefId}; signal areas ${result.signalCategories}; issues ${result.openIssueCount}; follow-ups ${result.followUpQuestionCount}`,
      );
    }
    if (generated.length > MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS) {
      lines.push(`- ...and ${generated.length - MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS} more`);
    }
  } else if (summary.skippedRecent === summary.totalCandidates) {
    lines.push('', 'No new briefs generated; every attention candidate already has a recent brief.');
  }

  const failures = summary.results.filter((result) => result.action === 'failed');
  if (failures.length > 0) {
    lines.push('', 'Failures:');
    for (const result of failures.slice(0, MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS)) {
      lines.push(`- ${result.accountName} - ${result.error}`);
    }
    if (failures.length > MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS) {
      lines.push(`- ...and ${failures.length - MAX_CLIENT_CHECKIN_ATTENTION_SWEEP_FORMAT_ROWS} more`);
    }
  }

  return lines.join('\n');
}

export function normalizeClientCheckinAttentionSweepSinceHours(hours: number | undefined): number {
  return normalizeOpsFleetDigestHours(hours);
}

export function normalizeClientCheckinAttentionSweepLimit(limit: number | undefined): number {
  return normalizeOpsAccountAttentionRunLimit(limit);
}

export function normalizeClientCheckinAttentionSweepMinSignals(
  minSignals: number | undefined,
): number {
  return normalizeOpsAccountAttentionRunMinSignals(minSignals);
}

export function normalizeClientCheckinAttentionSweepMinHours(hours: number | undefined): number {
  return normalizeClientCheckinFleetSweepMinHours(hours);
}

export function normalizeClientCheckinAttentionSweepConcurrency(
  concurrency: number | undefined,
): number {
  return normalizeClientCheckinFleetSweepConcurrency(concurrency);
}

function summarizeClientCheckinAttentionSweep(input: {
  sinceHours: number;
  since: string;
  minSignals: number;
  minHours: number;
  limit: number;
  concurrency: number;
  startedAt: string;
  completedAt: string;
  fleetTotalAttentionSignals: number;
  fleetAccountsWithAttention: number;
  totalCandidates: number;
  results: ClientCheckinAttentionSweepResult[];
}): ClientCheckinAttentionSweepSummary {
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

function parsePositiveIntegerArg(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw clientCheckinAttentionSweepUsageError();
  }
  return Number(value);
}

function clientCheckinAttentionSweepUsageError(): ValidationError {
  return new ValidationError(
    'Usage: /ops checkin-attention-run [hours] [--limit=N] [--min-signals=N] [--min-hours=N] [--concurrency=N]',
  );
}
