import { z } from 'zod';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { fetchGhlAccountInventory } from '../../lib/ghl/fetch-account-inventory.js';
import type { GhlAccountInventory } from '../../lib/ghl/inventory.js';
import type { Skill, SkillContext } from '../_types.js';

export const ghlInventoryInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type GhlInventoryInput = z.infer<typeof ghlInventoryInputSchema>;

export type GhlInventoryOutput = GhlAccountInventory;

export const ghlInventorySkill: Skill<GhlInventoryInput, GhlInventoryOutput> = {
  id: 'ghl.inventory',
  description: 'Build a GHL workflow and custom field inventory for one account',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: ghlInventoryInputSchema,
  async execute(input, ctx: SkillContext): Promise<GhlInventoryOutput> {
    const account = await resolveAccountInput(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.inventory',
      target: account.id,
      mutated: false,
      input: { accountId: account.id, accountName: account.name },
    });

    const inventory = await fetchGhlAccountInventory(account);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.inventory',
      target: account.id,
      mutated: false,
      output: {
        workflowCount: inventory.workflows.length,
        customFieldCount: inventory.customFields.length,
      },
    });

    return inventory;
  },
};
