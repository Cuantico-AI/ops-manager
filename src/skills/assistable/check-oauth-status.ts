import { z } from 'zod';
import {
  listAccountsForAssistableOAuthCheck,
  resolveAssistableLocationId,
  saveAssistableOAuthCheckResult,
  summarizeAssistableOAuthChecks,
  type AssistableAccountForOAuthCheck,
  type AssistableOAuthCheckResult,
  type AssistableOAuthCheckSummary,
} from '../../lib/accounts/assistable-oauth-health.js';
import { assistableClient, type AssistableClient } from '../../lib/assistable/client.js';
import type { Skill, SkillContext } from '../_types.js';

const DEFAULT_CONCURRENCY = 5;

export const checkAssistableOAuthInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  includeInactive: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

export type CheckAssistableOAuthInput = z.infer<typeof checkAssistableOAuthInputSchema>;

export interface CheckAssistableOAuthOutput {
  checkedAt: string;
  summary: AssistableOAuthCheckSummary;
  results: AssistableOAuthCheckResult[];
}

export const assistableCheckOAuthStatusSkill: Skill<
  CheckAssistableOAuthInput,
  CheckAssistableOAuthOutput
> = {
  id: 'assistable.check-oauth-status',
  description: 'Check Assistable GHL OAuth connection health for fleet accounts',
  mutates: false,
  requiresApproval: false,
  schema: checkAssistableOAuthInputSchema,
  async execute(input, ctx: SkillContext): Promise<CheckAssistableOAuthOutput> {
    const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
    const checkedAt = new Date().toISOString();

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'assistable.check-oauth-status',
      target: input.accountId ?? 'all-active-accounts',
      mutated: false,
      input: {
        accountId: input.accountId,
        accountQuery: input.accountQuery,
        includeInactive: input.includeInactive === true,
        concurrency,
      },
    });

    const accounts = await listAccountsForAssistableOAuthCheck({
      accountId: input.accountId,
      accountQuery: input.accountQuery,
      includeInactive: input.includeInactive === true,
    });
    const results = await checkAccounts(accounts, {
      checkedAt,
      concurrency,
      client: assistableClient,
    });
    const summary = summarizeAssistableOAuthChecks(results);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'assistable.check-oauth-status',
      target: input.accountId ?? 'all-active-accounts',
      mutated: false,
      output: summary,
    });

    return {
      checkedAt,
      summary,
      results,
    };
  },
};

async function checkAccounts(
  accounts: AssistableAccountForOAuthCheck[],
  opts: {
    checkedAt: string;
    concurrency: number;
    client: AssistableClient;
  },
): Promise<AssistableOAuthCheckResult[]> {
  const results: AssistableOAuthCheckResult[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < accounts.length) {
      const account = accounts[index];
      index += 1;
      if (account) {
        const result = await checkAccount(account, opts);
        await saveAssistableOAuthCheckResult(result);
        results.push(result);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, accounts.length) }, () => worker()),
  );

  return results.sort((left, right) => left.accountName.localeCompare(right.accountName));
}

async function checkAccount(
  account: AssistableAccountForOAuthCheck,
  opts: {
    checkedAt: string;
    client: AssistableClient;
  },
): Promise<AssistableOAuthCheckResult> {
  const resolved = resolveAssistableLocationId(account);
  if (!resolved) {
    return buildResult(account, opts.checkedAt, 'missing-subaccount-id');
  }

  const validation = await opts.client.checkLocationConnection({
    locationId: resolved.locationId,
  });

  return buildResult(account, opts.checkedAt, validation.status, {
    assistableLocationId: resolved.locationId,
    locationSource: resolved.source,
    httpStatus: validation.httpStatus,
    message: validation.message,
  });
}

function buildResult(
  account: AssistableAccountForOAuthCheck,
  checkedAt: string,
  status: AssistableOAuthCheckResult['status'],
  extra: {
    assistableLocationId?: string;
    locationSource?: AssistableOAuthCheckResult['locationSource'];
    httpStatus?: number;
    message?: string;
  } = {},
): AssistableOAuthCheckResult {
  const resolved = resolveAssistableLocationId(account);

  return {
    accountId: account.id,
    accountName: account.name,
    assistableLocationId: extra.assistableLocationId ?? resolved?.locationId ?? null,
    locationSource: extra.locationSource ?? resolved?.source ?? null,
    status,
    httpStatus: extra.httpStatus,
    message: extra.message,
    checkedAt,
  };
}
