import { z } from 'zod';
import { getAccountPitToken } from '../../lib/accounts/ghl-credentials.js';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { wrapMutation } from '../../lib/audit/wrap-mutation.js';
import { ValidationError } from '../../lib/errors.js';
import { ghlClient, type GhlClient, type GhlCustomValue } from '../../lib/ghl/client.js';
import type { Skill, SkillContext } from '../_types.js';

export const setCustomValueInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  customValueId: z.string().trim().min(1),
  value: z.string(),
});

export type SetCustomValueInput = z.infer<typeof setCustomValueInputSchema>;

export interface SetCustomValueOutput {
  accountId: string;
  accountName: string;
  locationId: string;
  customValueId: string;
  previousValue: string;
  customValue: GhlCustomValue;
  updatedAt: string;
}

export const ghlSetCustomValueSkill: Skill<SetCustomValueInput, SetCustomValueOutput> = {
  id: 'ghl.set-custom-value',
  description: 'Update a GHL location custom value for an account',
  mutates: true,
  requiresApproval: true,
  autonomousEligible: false,
  schema: setCustomValueInputSchema,
  async execute(input, ctx: SkillContext): Promise<SetCustomValueOutput> {
    const account = await resolveAccountInput(input);
    if (!account.ghlLocationId) {
      throw new ValidationError(`Account "${account.name}" has no GHL location ID`);
    }

    const targetSummary = `Set GHL custom value ${input.customValueId} for ${account.name}`;
    const approval = await ctx.approval.gate({
      jobId: ctx.jobId,
      skill: 'ghl.set-custom-value',
      targetSummary,
      proposedAction: input,
    });

    return wrapMutation(() => mutateCustomValue(account, input, ghlClient), {
      audit: ctx.audit,
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.set-custom-value',
      target: account.id,
      approvalId: approval.approvalId,
      input: {
        accountId: account.id,
        accountName: account.name,
        customValueId: input.customValueId,
        value: input.value,
      },
      output: (result) => ({
        customValueId: result.customValueId,
        previousValue: result.previousValue,
        value: result.customValue.value,
      }),
    });
  },
};

export function formatSetCustomValueOutput(output: SetCustomValueOutput): string {
  return [
    'GHL custom value updated.',
    `Account: ${output.accountName}`,
    `Location ID: ${output.locationId}`,
    `Custom value ID: ${output.customValueId}`,
    `Name: ${output.customValue.name}`,
    `Previous value: ${output.previousValue}`,
    `New value: ${output.customValue.value}`,
  ].join('\n');
}

async function mutateCustomValue(
  account: {
    id: string;
    name: string;
    ghlLocationId: string | null;
    ghlPitTokenRef: string | null;
  },
  input: SetCustomValueInput,
  client: GhlClient,
): Promise<SetCustomValueOutput> {
  const pitToken = await getAccountPitToken(account);
  const locationId = account.ghlLocationId!;
  const current = await client.getCustomValue(locationId, input.customValueId, pitToken);
  const updated = await client.updateCustomValue(
    locationId,
    input.customValueId,
    pitToken,
    {
      name: current.name,
      value: input.value,
    },
  );

  return {
    accountId: account.id,
    accountName: account.name,
    locationId,
    customValueId: input.customValueId,
    previousValue: current.value,
    customValue: updated,
    updatedAt: new Date().toISOString(),
  };
}
