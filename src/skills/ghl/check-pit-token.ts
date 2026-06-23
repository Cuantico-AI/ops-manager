import { z } from 'zod';
import {
  listAccountsForGhlTokenCheck,
  saveGhlTokenCheckResult,
  summarizeGhlTokenChecks,
  type GhlAccountForTokenCheck,
  type GhlTokenCheckResult,
  type GhlTokenCheckSummary,
} from '../../lib/accounts/ghl-token-health.js';
import { ghlClient, type GhlClient } from '../../lib/ghl/client.js';
import { fingerprintPitToken, normalizePitToken } from '../../lib/ghl/token-utils.js';
import { PostgresSecretStore, type SecretStore } from '../../lib/secrets/store.js';
import type { Skill, SkillContext } from '../_types.js';

const DEFAULT_CONCURRENCY = 5;

export const checkPitTokenInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  includeInactive: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

export type CheckPitTokenInput = z.infer<typeof checkPitTokenInputSchema>;

export interface CheckPitTokenOutput {
  checkedAt: string;
  summary: GhlTokenCheckSummary;
  results: GhlTokenCheckResult[];
}

export const ghlCheckPitTokenSkill: Skill<CheckPitTokenInput, CheckPitTokenOutput> = {
  id: 'ghl.check-pit-token',
  description: 'Validate stored GHL PIT tokens against LeadConnector v2',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: checkPitTokenInputSchema,
  async execute(input, ctx: SkillContext): Promise<CheckPitTokenOutput> {
    const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
    const checkedAt = new Date().toISOString();

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.check-pit-token',
      target: input.accountId ?? 'all-active-accounts',
      mutated: false,
      input: {
        accountId: input.accountId,
        accountQuery: input.accountQuery,
        includeInactive: input.includeInactive === true,
        concurrency,
      },
    });

    const accounts = await listAccountsForGhlTokenCheck({
      accountId: input.accountId,
      accountQuery: input.accountQuery,
      includeInactive: input.includeInactive === true,
    });
    const results = await checkAccounts(accounts, {
      checkedAt,
      concurrency,
      secretStore: new PostgresSecretStore(),
      client: ghlClient,
    });
    const summary = summarizeGhlTokenChecks(results);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.check-pit-token',
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
  accounts: GhlAccountForTokenCheck[],
  opts: {
    checkedAt: string;
    concurrency: number;
    secretStore: SecretStore;
    client: GhlClient;
  },
): Promise<GhlTokenCheckResult[]> {
  const results: GhlTokenCheckResult[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < accounts.length) {
      const account = accounts[index];
      index += 1;
      if (account) {
        const result = await checkAccount(account, opts);
        await saveGhlTokenCheckResult(result);
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
  account: GhlAccountForTokenCheck,
  opts: {
    checkedAt: string;
    secretStore: SecretStore;
    client: GhlClient;
  },
): Promise<GhlTokenCheckResult> {
  if (!account.ghlLocationId) {
    return buildResult(account, opts.checkedAt, 'missing-location');
  }
  if (!account.ghlPitTokenRef) {
    return buildResult(account, opts.checkedAt, 'missing-token');
  }

  let pitToken: string;
  try {
    pitToken = normalizePitToken(
      await opts.secretStore.getSecret(account.ghlPitTokenRef, {
        kind: 'ghl-pit-token',
      }),
    );
  } catch (err) {
    return buildResult(account, opts.checkedAt, 'secret-error', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const validation = await opts.client.validatePitToken({
    locationId: account.ghlLocationId,
    pitToken,
  });

  return buildResult(account, opts.checkedAt, validation.status, {
    httpStatus: validation.httpStatus,
    tokenFingerprint: fingerprintPitToken(pitToken),
  });
}

function buildResult(
  account: GhlAccountForTokenCheck,
  checkedAt: string,
  status: GhlTokenCheckResult['status'],
  extra: { httpStatus?: number; message?: string; tokenFingerprint?: string } = {},
): GhlTokenCheckResult {
  return {
    accountId: account.id,
    accountName: account.name,
    ghlLocationId: account.ghlLocationId,
    status,
    httpStatus: extra.httpStatus,
    message: extra.message,
    tokenFingerprint: extra.tokenFingerprint,
    checkedAt,
  };
}
