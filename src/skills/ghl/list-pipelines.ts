import { z } from 'zod';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { fetchGhlAccountSnapshot } from '../../lib/ghl/fetch-account-snapshot.js';
import type { GhlAccountSnapshot } from '../../lib/ghl/snapshot.js';
import type { Skill, SkillContext } from '../_types.js';

export const listPipelinesInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type ListPipelinesInput = z.infer<typeof listPipelinesInputSchema>;

export interface ListPipelinesOutput {
  accountId: string;
  accountName: string;
  locationId: string;
  pipelines: GhlAccountSnapshot['pipelines'];
}

export const ghlListPipelinesSkill: Skill<ListPipelinesInput, ListPipelinesOutput> = {
  id: 'ghl.list-pipelines',
  description: 'List GHL opportunity pipelines for an account',
  mutates: false,
  requiresApproval: false,
  schema: listPipelinesInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListPipelinesOutput> {
    const account = await resolveAccountInput(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-pipelines',
      target: account.id,
      mutated: false,
      input: { accountId: account.id, accountName: account.name },
    });

    const snapshot = await fetchGhlAccountSnapshot(account);
    const output: ListPipelinesOutput = {
      accountId: account.id,
      accountName: account.name,
      locationId: snapshot.locationId,
      pipelines: snapshot.pipelines,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-pipelines',
      target: account.id,
      mutated: false,
      output: {
        pipelineCount: output.pipelines.length,
        totalOpportunities: output.pipelines.reduce(
          (sum, pipeline) => sum + pipeline.totalOpportunities,
          0,
        ),
      },
    });

    return output;
  },
};
