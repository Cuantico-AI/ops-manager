import { z } from 'zod';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { fetchGhlAccountInventory } from '../../lib/ghl/fetch-account-inventory.js';
import type { GhlAccountInventory } from '../../lib/ghl/inventory.js';
import type { Skill, SkillContext } from '../_types.js';

export const listCustomFieldsInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type ListCustomFieldsInput = z.infer<typeof listCustomFieldsInputSchema>;

export interface ListCustomFieldsOutput {
  accountId: string;
  accountName: string;
  locationId: string;
  customFields: GhlAccountInventory['customFields'];
}

export const ghlListCustomFieldsSkill: Skill<ListCustomFieldsInput, ListCustomFieldsOutput> = {
  id: 'ghl.list-custom-fields',
  description: 'List GHL custom fields for an account',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: listCustomFieldsInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListCustomFieldsOutput> {
    const account = await resolveAccountInput(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-custom-fields',
      target: account.id,
      mutated: false,
      input: { accountId: account.id, accountName: account.name },
    });

    const inventory = await fetchGhlAccountInventory(account);
    const output: ListCustomFieldsOutput = {
      accountId: account.id,
      accountName: account.name,
      locationId: inventory.locationId,
      customFields: inventory.customFields,
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.list-custom-fields',
      target: account.id,
      mutated: false,
      output: { customFieldCount: output.customFields.length },
    });

    return output;
  },
};
