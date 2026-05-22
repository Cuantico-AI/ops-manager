import { z } from 'zod';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { fetchGhlAccountSnapshot } from '../../lib/ghl/fetch-account-snapshot.js';
import type { GhlAccountSnapshot } from '../../lib/ghl/snapshot.js';
import type { Skill, SkillContext } from '../_types.js';

export const listOpportunitiesInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type ListOpportunitiesInput = z.infer<typeof listOpportunitiesInputSchema>;

export interface ListOpportunitiesOutput {
  accountId: string;
  accountName: string;
  locationId: string;
  totalOpportunities: number;
  pipelines: GhlAccountSnapshot['pipelines'];
}

export const ghlListOpportunitiesSkill: Skill<ListOpportunitiesInput, ListOpportunitiesOutput> = {
  id: 'ghl.list-opportunities',
  description: 'Summarize GHL opportunities by pipeline stage for an account',
  mutates: false,
  requiresApproval: false,
  schema: listOpportunitiesInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListOpportunitiesOutput> {
    const account = await resolveAccountInput(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-opportunities',
      target: account.id,
      mutated: false,
      input: { accountId: account.id, accountName: account.name },
    });

    const snapshot = await fetchGhlAccountSnapshot(account);
    const output: ListOpportunitiesOutput = {
      accountId: account.id,
      accountName: account.name,
      locationId: snapshot.locationId,
      totalOpportunities: snapshot.totalOpportunities,
      pipelines: snapshot.pipelines,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-opportunities',
      target: account.id,
      mutated: false,
      output: {
        totalOpportunities: output.totalOpportunities,
        pipelineCount: output.pipelines.length,
      },
    });

    return output;
  },
};
