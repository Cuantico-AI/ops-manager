import { z } from 'zod';
import {
  listAccountsForN8nWorkflowCheck,
  saveN8nWorkflowCheckResult,
  summarizeN8nWorkflowChecks,
  type N8nAccountForWorkflowCheck,
  type N8nAccountWorkflowCheckResult,
  type N8nWorkflowCheckSummary,
} from '../../lib/accounts/n8n-workflow-health.js';
import {
  buildAccountWorkflowResult,
  checkAccountWorkflows,
} from '../../lib/n8n/fetch-account-workflow-health.js';
import { n8nClient, type N8nClient } from '../../lib/n8n/client.js';
import type { Skill, SkillContext } from '../_types.js';

const DEFAULT_CONCURRENCY = 3;

export const checkN8nWorkflowHealthInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  includeInactive: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

export type CheckN8nWorkflowHealthInput = z.infer<typeof checkN8nWorkflowHealthInputSchema>;

export interface CheckN8nWorkflowHealthOutput {
  checkedAt: string;
  summary: N8nWorkflowCheckSummary;
  results: N8nAccountWorkflowCheckResult[];
}

export const n8nCheckWorkflowHealthSkill: Skill<
  CheckN8nWorkflowHealthInput,
  CheckN8nWorkflowHealthOutput
> = {
  id: 'n8n.check-workflow-health',
  description: 'Check n8n workflow health for fleet accounts',
  mutates: false,
  requiresApproval: false,
  schema: checkN8nWorkflowHealthInputSchema,
  async execute(input, ctx: SkillContext): Promise<CheckN8nWorkflowHealthOutput> {
    const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
    const checkedAt = new Date().toISOString();

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'n8n.check-workflow-health',
      target: input.accountId ?? 'all-active-accounts',
      mutated: false,
      input: {
        accountId: input.accountId,
        accountQuery: input.accountQuery,
        includeInactive: input.includeInactive === true,
        concurrency,
      },
    });

    const accounts = await listAccountsForN8nWorkflowCheck({
      accountId: input.accountId,
      accountQuery: input.accountQuery,
      includeInactive: input.includeInactive === true,
    });
    const results = await checkAccounts(accounts, {
      checkedAt,
      concurrency,
      client: n8nClient,
    });
    const summary = summarizeN8nWorkflowChecks(results);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'n8n.check-workflow-health',
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
  accounts: N8nAccountForWorkflowCheck[],
  opts: {
    checkedAt: string;
    concurrency: number;
    client: N8nClient;
  },
): Promise<N8nAccountWorkflowCheckResult[]> {
  const results: N8nAccountWorkflowCheckResult[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < accounts.length) {
      const account = accounts[index];
      index += 1;
      if (!account) {
        continue;
      }

      const workflows = await checkAccountWorkflows(account, opts.client);
      const result = buildAccountWorkflowResult(account, workflows, opts.checkedAt);
      await saveN8nWorkflowCheckResult(result);
      results.push(result);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, accounts.length) }, () => worker()),
  );

  return results.sort((left, right) => left.accountName.localeCompare(right.accountName));
}
