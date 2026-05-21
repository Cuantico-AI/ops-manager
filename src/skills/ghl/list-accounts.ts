import { z } from 'zod';
import {
  listStoredAccounts,
  syncGoogleSheetRoster,
  type AccountSummary,
  type RosterSyncSummary,
} from '../../lib/accounts/google-sheet-roster.js';
import type { Skill, SkillContext } from '../_types.js';

export const listAccountsInputSchema = z.object({
  syncFromGoogleSheet: z.boolean().default(false),
  csvUrl: z.string().url().optional(),
});

export type ListAccountsInput = z.infer<typeof listAccountsInputSchema>;

export interface ListAccountsOutput {
  accounts: AccountSummary[];
  sync?: RosterSyncSummary;
}

export const ghlListAccountsSkill: Skill<ListAccountsInput, ListAccountsOutput> = {
  id: 'ghl.list-accounts',
  description: 'List known GHL accounts and optionally sync the roster from Google Sheets',
  mutates: false,
  requiresApproval: false,
  schema: listAccountsInputSchema,
  async execute(input, ctx: SkillContext): Promise<ListAccountsOutput> {
    const actor = ctx.agentId;

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor,
      action: 'ghl.list-accounts',
      target: input.syncFromGoogleSheet ? 'google-sheet-roster' : 'accounts',
      mutated: false,
      input: {
        syncFromGoogleSheet: input.syncFromGoogleSheet,
        rosterSourceConfigured: Boolean(
          input.csvUrl ??
          process.env.GOOGLE_SHEET_ROSTER_CSV_URL ??
          process.env.GOOGLE_SHEET_ROSTER_SPREADSHEET_ID,
        ),
      },
    });

    const output = input.syncFromGoogleSheet
      ? await syncAndListAccounts(input.csvUrl)
      : { accounts: await listStoredAccounts() };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor,
      action: 'ghl.list-accounts',
      target: input.syncFromGoogleSheet ? 'google-sheet-roster' : 'accounts',
      mutated: false,
      output: {
        accountCount: output.accounts.length,
        sync: output.sync,
      },
    });

    return output;
  },
};

async function syncAndListAccounts(csvUrl: string | undefined): Promise<ListAccountsOutput> {
  const { summary, accounts } = await syncGoogleSheetRoster(csvUrl);
  return { accounts, sync: summary };
}
