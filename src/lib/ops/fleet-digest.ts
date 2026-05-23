import {
  fetchClientCheckinFleetSummary,
  type ClientCheckinFleetSummary,
} from '../client-checkin/fleet-summary.js';
import {
  fetchPromptOpsFleetSummary,
  type PromptOpsFleetSummary,
} from '../prompt-ops/fleet-summary.js';
import { fetchFleetQaSummary, type FleetQaSummary } from '../qa/fleet-summary.js';

const DEFAULT_OPS_FLEET_DIGEST_HOURS = 24;
const MAX_OPS_FLEET_DIGEST_HOURS = 168;
const DEFAULT_OPS_FLEET_DIGEST_LIMIT = 10;
const MAX_OPS_FLEET_DIGEST_LIMIT = 25;

export interface FetchOpsFleetDigestInput {
  sinceHours?: number;
  limit?: number;
}

export interface OpsFleetDigestAccountSignal {
  accountId: string;
  accountName: string;
  qaFailures: number;
  qaReviews: number;
  clientCheckinAttention: number;
  clientCheckinBriefs: number;
  promptOpsAttention: number;
  promptOpsReviews: number;
  signalCategories: number;
  attentionSignals: number;
  latestSignalAt: string | null;
}

export interface OpsFleetDigestSummary {
  sinceHours: number;
  since: string;
  generatedAt: string;
  limit: number;
  qa: FleetQaSummary;
  clientCheckin: ClientCheckinFleetSummary;
  promptOps: PromptOpsFleetSummary;
  totalAttentionSignals: number;
  accountsWithAttention: number;
  multiSignalAccounts: OpsFleetDigestAccountSignal[];
  topAccounts: OpsFleetDigestAccountSignal[];
}

export async function fetchOpsFleetDigest(
  input: FetchOpsFleetDigestInput = {},
): Promise<OpsFleetDigestSummary> {
  const sinceHours = normalizeOpsFleetDigestHours(input.sinceHours);
  const limit = normalizeOpsFleetDigestLimit(input.limit);
  const [qa, clientCheckin, promptOps] = await Promise.all([
    fetchFleetQaSummary({ sinceHours, limit }),
    fetchClientCheckinFleetSummary({ sinceHours, limit }),
    fetchPromptOpsFleetSummary({ sinceHours, limit }),
  ]);

  const accountSignals = buildAccountSignals({ qa, clientCheckin, promptOps });
  const topAccounts = accountSignals.slice(0, limit);

  return {
    sinceHours,
    since: earliestSince([qa.since, clientCheckin.since, promptOps.since]),
    generatedAt: new Date().toISOString(),
    limit,
    qa,
    clientCheckin,
    promptOps,
    totalAttentionSignals:
      qa.failedReviews + clientCheckin.attentionBriefs + promptOps.attentionReviews,
    accountsWithAttention: accountSignals.length,
    multiSignalAccounts: accountSignals
      .filter((account) => account.signalCategories > 1)
      .slice(0, limit),
    topAccounts,
  };
}

export function normalizeOpsFleetDigestHours(hours: number | undefined): number {
  if (!hours) {
    return DEFAULT_OPS_FLEET_DIGEST_HOURS;
  }

  return Math.min(Math.max(Math.trunc(hours), 1), MAX_OPS_FLEET_DIGEST_HOURS);
}

export function normalizeOpsFleetDigestLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_OPS_FLEET_DIGEST_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_OPS_FLEET_DIGEST_LIMIT);
}

function buildAccountSignals(input: {
  qa: FleetQaSummary;
  clientCheckin: ClientCheckinFleetSummary;
  promptOps: PromptOpsFleetSummary;
}): OpsFleetDigestAccountSignal[] {
  const signals = new Map<string, OpsFleetDigestAccountSignal>();

  for (const account of input.qa.topAccounts) {
    const signal = getOrCreateSignal(signals, account.accountId, account.accountName);
    signal.qaFailures += account.failedReviews;
    signal.qaReviews += account.totalReviews;
  }
  for (const failure of input.qa.failures) {
    const signal = getOrCreateSignal(signals, failure.accountId, failure.accountName);
    signal.qaFailures = Math.max(signal.qaFailures, 1);
    signal.latestSignalAt = latestIso(signal.latestSignalAt, failure.reviewedAt);
  }

  for (const account of input.clientCheckin.topAccounts) {
    const signal = getOrCreateSignal(signals, account.accountId, account.accountName);
    signal.clientCheckinAttention += account.attentionBriefs;
    signal.clientCheckinBriefs += account.totalBriefs;
    signal.latestSignalAt = latestIso(signal.latestSignalAt, account.latestGeneratedAt);
  }
  for (const brief of input.clientCheckin.recentAttention) {
    const signal = getOrCreateSignal(signals, brief.accountId, brief.accountName);
    signal.clientCheckinAttention = Math.max(signal.clientCheckinAttention, 1);
    signal.latestSignalAt = latestIso(signal.latestSignalAt, brief.generatedAt);
  }

  for (const account of input.promptOps.topAccounts) {
    const signal = getOrCreateSignal(signals, account.accountId, account.accountName);
    signal.promptOpsAttention += account.attentionReviews;
    signal.promptOpsReviews += account.totalReviews;
    signal.latestSignalAt = latestIso(signal.latestSignalAt, account.latestReviewedAt);
  }
  for (const review of input.promptOps.recentAttention) {
    const signal = getOrCreateSignal(signals, review.accountId, review.accountName);
    signal.promptOpsAttention = Math.max(signal.promptOpsAttention, 1);
    signal.latestSignalAt = latestIso(signal.latestSignalAt, review.reviewedAt);
  }

  return Array.from(signals.values())
    .map((signal) => ({
      ...signal,
      signalCategories: countPositive([
        signal.qaFailures,
        signal.clientCheckinAttention,
        signal.promptOpsAttention,
      ]),
      attentionSignals:
        signal.qaFailures + signal.clientCheckinAttention + signal.promptOpsAttention,
    }))
    .sort((a, b) => {
      if (b.signalCategories !== a.signalCategories) {
        return b.signalCategories - a.signalCategories;
      }
      if (b.attentionSignals !== a.attentionSignals) {
        return b.attentionSignals - a.attentionSignals;
      }
      return a.accountName.localeCompare(b.accountName);
    });
}

function getOrCreateSignal(
  signals: Map<string, OpsFleetDigestAccountSignal>,
  accountId: string,
  accountName: string,
): OpsFleetDigestAccountSignal {
  const existing = signals.get(accountId);
  if (existing) {
    return existing;
  }

  const signal: OpsFleetDigestAccountSignal = {
    accountId,
    accountName,
    qaFailures: 0,
    qaReviews: 0,
    clientCheckinAttention: 0,
    clientCheckinBriefs: 0,
    promptOpsAttention: 0,
    promptOpsReviews: 0,
    signalCategories: 0,
    attentionSignals: 0,
    latestSignalAt: null,
  };
  signals.set(accountId, signal);
  return signal;
}

function countPositive(values: number[]): number {
  return values.filter((value) => value > 0).length;
}

function earliestSince(values: string[]): string {
  return values.reduce((earliest, value) =>
    Date.parse(value) < Date.parse(earliest) ? value : earliest,
  );
}

function latestIso(current: string | null, next: string): string {
  if (!current) {
    return next;
  }

  return Date.parse(next) > Date.parse(current) ? next : current;
}
