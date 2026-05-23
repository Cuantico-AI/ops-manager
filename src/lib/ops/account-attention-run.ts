import { z } from 'zod';
import { ValidationError } from '../errors.js';
import {
  fetchOpsAccountDigest,
  type FetchOpsAccountDigestInput,
  type OpsAccountDigestSummary,
} from './account-digest.js';
import {
  fetchOpsFleetDigest,
  normalizeOpsFleetDigestHours,
  normalizeOpsFleetDigestLimit,
  type FetchOpsFleetDigestInput,
  type OpsFleetDigestAccountSignal,
} from './fleet-digest.js';

const DEFAULT_OPS_ACCOUNT_ATTENTION_RUN_LIMIT = 5;
const MAX_OPS_ACCOUNT_ATTENTION_RUN_LIMIT = 25;
const DEFAULT_OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS = 2;
const MAX_OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS = 3;
const DEFAULT_OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY = 3;
const MAX_OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY = 10;
const MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS = 10;

export interface OpsAccountAttentionRunCandidate extends OpsFleetDigestAccountSignal {}

export type OpsAccountAttentionRunResult =
  | {
      accountId: string;
      accountName: string;
      action: 'digested';
      candidate: OpsAccountAttentionRunCandidate;
      digest: OpsAccountDigestSummary;
    }
  | {
      accountId: string;
      accountName: string;
      action: 'failed';
      candidate: OpsAccountAttentionRunCandidate;
      error: string;
    };

export interface OpsAccountAttentionRunSummary {
  sinceHours: number;
  since: string;
  generatedAt: string;
  limit: number;
  minSignals: number;
  accountDigestLimit: number;
  concurrency: number;
  fleetTotalAttentionSignals: number;
  fleetAccountsWithAttention: number;
  totalCandidates: number;
  digested: number;
  failed: number;
  totalAttentionSignals: number;
  results: OpsAccountAttentionRunResult[];
}

export interface ExecuteOpsAccountAttentionRunInput {
  sinceHours?: number;
  limit?: number;
  minSignals?: number;
  accountDigestLimit?: number;
  concurrency?: number;
  fetchFleetDigest?: (input: FetchOpsFleetDigestInput) => Promise<{
    since: string;
    generatedAt: string;
    totalAttentionSignals: number;
    accountsWithAttention: number;
    multiSignalAccounts: OpsFleetDigestAccountSignal[];
    topAccounts: OpsFleetDigestAccountSignal[];
  }>;
  fetchAccountDigest?: (input: FetchOpsAccountDigestInput) => Promise<OpsAccountDigestSummary>;
}

export const opsAccountAttentionRunCommandArgsSchema = z.object({
  sinceHours: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  minSignals: z.number().int().positive().optional(),
  accountDigestLimit: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});

export type OpsAccountAttentionRunCommandArgs = z.infer<
  typeof opsAccountAttentionRunCommandArgsSchema
>;

export async function executeOpsAccountAttentionRun(
  input: ExecuteOpsAccountAttentionRunInput = {},
): Promise<OpsAccountAttentionRunSummary> {
  const sinceHours = normalizeOpsFleetDigestHours(input.sinceHours);
  const limit = normalizeOpsAccountAttentionRunLimit(input.limit);
  const minSignals = normalizeOpsAccountAttentionRunMinSignals(input.minSignals);
  const accountDigestLimit = normalizeOpsFleetDigestLimit(input.accountDigestLimit);
  const concurrency = normalizeOpsAccountAttentionRunConcurrency(input.concurrency);
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
  const fetchAccount = input.fetchAccountDigest ?? fetchOpsAccountDigest;
  const indexedResults: Array<{ index: number; result: OpsAccountAttentionRunResult }> = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < candidates.length) {
      const currentIndex = index;
      index += 1;
      const candidate = candidates[currentIndex];
      if (!candidate) {
        continue;
      }

      try {
        const digest = await fetchAccount({
          accountId: candidate.accountId,
          sinceHours,
          limit: accountDigestLimit,
        });
        indexedResults.push({
          index: currentIndex,
          result: {
            accountId: candidate.accountId,
            accountName: candidate.accountName,
            action: 'digested',
            candidate,
            digest,
          },
        });
      } catch (err) {
        indexedResults.push({
          index: currentIndex,
          result: {
            accountId: candidate.accountId,
            accountName: candidate.accountName,
            action: 'failed',
            candidate,
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
  const digestedResults = results.filter((result) => result.action === 'digested');

  return {
    sinceHours,
    since: fleetDigest.since,
    generatedAt: new Date().toISOString(),
    limit,
    minSignals,
    accountDigestLimit,
    concurrency,
    fleetTotalAttentionSignals: fleetDigest.totalAttentionSignals,
    fleetAccountsWithAttention: fleetDigest.accountsWithAttention,
    totalCandidates: candidates.length,
    digested: digestedResults.length,
    failed: results.filter((result) => result.action === 'failed').length,
    totalAttentionSignals: digestedResults.reduce(
      (total, result) => total + result.digest.totalAttentionSignals,
      0,
    ),
    results,
  };
}

export function selectOpsAccountAttentionCandidates(input: {
  multiSignalAccounts: OpsFleetDigestAccountSignal[];
  topAccounts: OpsFleetDigestAccountSignal[];
  minSignals: number;
  limit: number;
}): OpsAccountAttentionRunCandidate[] {
  const byAccount = new Map<string, OpsFleetDigestAccountSignal>();
  for (const account of [...input.multiSignalAccounts, ...input.topAccounts]) {
    const existing = byAccount.get(account.accountId);
    if (!existing || account.signalCategories > existing.signalCategories) {
      byAccount.set(account.accountId, account);
    }
  }

  return Array.from(byAccount.values())
    .filter((account) => account.signalCategories >= input.minSignals)
    .sort((left, right) => {
      if (right.signalCategories !== left.signalCategories) {
        return right.signalCategories - left.signalCategories;
      }
      if (right.attentionSignals !== left.attentionSignals) {
        return right.attentionSignals - left.attentionSignals;
      }
      return left.accountName.localeCompare(right.accountName);
    })
    .slice(0, input.limit);
}

export function parseOpsAccountAttentionRunCommandArgs(
  args: string,
): OpsAccountAttentionRunCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const parsed: OpsAccountAttentionRunCommandArgs = {};

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }

    if (/^\d+$/.test(token)) {
      if (parsed.sinceHours !== undefined) {
        throw opsAccountAttentionRunUsageError();
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
    if (flag === '--digest-limit') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.accountDigestLimit = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }
    if (flag === '--concurrency') {
      const value = inlineValue ?? tokens[i + 1];
      parsed.concurrency = parsePositiveIntegerArg(value);
      if (!inlineValue) i += 1;
      continue;
    }

    throw opsAccountAttentionRunUsageError();
  }

  return parsed;
}

export function formatOpsAccountAttentionRunOutput(
  summary: OpsAccountAttentionRunSummary,
): string {
  const lines = [
    'Ops account attention run complete.',
    `Window: last ${summary.sinceHours} hour(s) since ${summary.since}`,
    `Filter: at least ${summary.minSignals} attention area(s); candidates up to ${summary.limit}; per-account detail limit ${summary.accountDigestLimit}`,
    `Fleet attention: ${summary.fleetTotalAttentionSignals} signal(s) across ${summary.fleetAccountsWithAttention} account(s)`,
    `Candidates: ${summary.totalCandidates}`,
    `Digested: ${summary.digested}`,
    `Failed: ${summary.failed}`,
  ];

  if (summary.totalCandidates === 0) {
    lines.push('', 'No accounts met the attention filter in this window.');
    return lines.join('\n');
  }

  const digested = summary.results.filter((result) => result.action === 'digested');
  if (digested.length > 0) {
    lines.push('', `Account digests (up to ${MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS}):`);
    for (const result of digested.slice(0, MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS)) {
      lines.push(formatAccountAttentionDigestLine(result.digest));
    }
    if (digested.length > MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS) {
      lines.push(`- ...and ${digested.length - MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS} more`);
    }
  }

  const failures = summary.results.filter((result) => result.action === 'failed');
  if (failures.length > 0) {
    lines.push('', 'Failures:');
    for (const result of failures.slice(0, MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS)) {
      lines.push(`- ${result.accountName}: ${result.error}`);
    }
    if (failures.length > MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS) {
      lines.push(`- ...and ${failures.length - MAX_OPS_ACCOUNT_ATTENTION_RUN_FORMAT_ROWS} more`);
    }
  }

  return lines.join('\n');
}

export function normalizeOpsAccountAttentionRunLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_OPS_ACCOUNT_ATTENTION_RUN_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_OPS_ACCOUNT_ATTENTION_RUN_LIMIT);
}

export function normalizeOpsAccountAttentionRunMinSignals(
  minSignals: number | undefined,
): number {
  if (!minSignals || !Number.isFinite(minSignals)) {
    return DEFAULT_OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS;
  }

  return Math.min(
    Math.max(Math.trunc(minSignals), 1),
    MAX_OPS_ACCOUNT_ATTENTION_RUN_MIN_SIGNALS,
  );
}

export function normalizeOpsAccountAttentionRunConcurrency(
  concurrency: number | undefined,
): number {
  if (!concurrency || !Number.isFinite(concurrency)) {
    return DEFAULT_OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY;
  }

  return Math.min(Math.max(Math.trunc(concurrency), 1), MAX_OPS_ACCOUNT_ATTENTION_RUN_CONCURRENCY);
}

function formatAccountAttentionDigestLine(digest: OpsAccountDigestSummary): string {
  const latest = digest.latestSignalAt ? `; latest ${digest.latestSignalAt}` : '';
  return [
    `- ${digest.accountName}: ${digest.totalAttentionSignals} signal(s) across ${digest.signalCategories} area(s)${latest}`,
    `  QA failures ${digest.qa.failedReviews}/${digest.qa.totalReviews}; check-ins ${digest.clientCheckin.attentionBriefs}/${digest.clientCheckin.totalBriefs}; Prompt Ops ${digest.promptOps.attentionReviews}/${digest.promptOps.totalReviews}`,
  ].join('\n');
}

function parsePositiveIntegerArg(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw opsAccountAttentionRunUsageError();
  }
  return Number(value);
}

function opsAccountAttentionRunUsageError(): ValidationError {
  return new ValidationError(
    'Usage: /ops account-attention-run [hours] [--limit=N] [--min-signals=N] [--digest-limit=N] [--concurrency=N]',
  );
}
