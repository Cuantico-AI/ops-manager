import { z } from 'zod';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { fetchGhlAccountInventory } from '../../lib/ghl/fetch-account-inventory.js';
import type { GhlAccountInventory } from '../../lib/ghl/inventory.js';
import type { Skill, SkillContext } from '../_types.js';

export const listWorkflowsInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type ListWorkflowsInput = z.infer<typeof listWorkflowsInputSchema>;

export interface ListWorkflowsOutput {
  accountId: string;
  accountName: string;
  locationId: string;
  workflows: GhlAccountInventory['workflows'];
}

export const ghlListWorkflowsSkill: Skill<ListWorkflowsInput, ListWorkflowsOutput> = {
  id: 'ghl.list-workflows',
  description: 'List GHL workflows for an account',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: listWorkflowsInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListWorkflowsOutput> {
    const account = await resolveAccountInput(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-workflows',
      target: account.id,
      mutated: false,
      input: { accountId: account.id, accountName: account.name },
    });

    const inventory = await fetchGhlAccountInventory(account);
    const output: ListWorkflowsOutput = {
      accountId: account.id,
      accountName: account.name,
      locationId: inventory.locationId,
      workflows: inventory.workflows,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-workflows',
      target: account.id,
      mutated: false,
      output: { workflowCount: output.workflows.length },
    });

    return output;
  },
};
